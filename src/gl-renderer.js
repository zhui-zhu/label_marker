class GLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.timeAxisCanvas = null;
        this.timeAxisCtx = null;

        this.gl = canvas.getContext('webgl2', {
            antialias: false,
            alpha: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
        });

        if (!this.gl) {
            throw new Error('WebGL2 not supported');
        }

        this.channels = [];
        this.channelVBOs = [];
        this.channelSampleCounts = [];
        this.viewportStart = 0;
        this.viewportEnd = 30;
        this.sfreq = 500;
        this.totalDuration = 0;
        this.sensitivity = 1.0;
        this.dragging = false;
        this.lastMouseX = 0;
        this.dpr = window.devicePixelRatio || 1;
        this.selectedChannel = null;
        this.fixedHeightMode = false;
        this.fixedChannelHeight = 80;
        this.channelScrollY = 0;

        // 预览色带属性
        this._previewAnnotation = null;

        // 当前显示模式：单极或双极
        this.showBipolarMode = false;

        this._initShaders();
        this._initQuad();
        this._initAnnotationBuffers();
        this._setupInteraction();
        this._resize();
    }

    setBipolarMode(show) {
        this.showBipolarMode = show;
    }

    setSelectedChannel(name) {
        this.selectedChannel = name;
    }

    setTimeAxisCanvas(canvas) {
        this.timeAxisCanvas = canvas;
        this.timeAxisCtx = canvas ? canvas.getContext('2d') : null;
        if (canvas) {
            this._resizeTimeAxis();
        }
    }

    setFixedHeightMode(enabled) {
        this.fixedHeightMode = enabled;
        this.channelScrollY = 0;
    }

    get maxChannelScrollY() {
        if (!this.fixedHeightMode || this.channels.length === 0) return 0;
        const canvasHeight = this.canvas.clientHeight;
        const totalHeight = this.channels.length * this.fixedChannelHeight;
        return Math.max(0, totalHeight - canvasHeight);
    }

    setChannelScrollY(value) {
        this.channelScrollY = Math.max(0, Math.min(value, this.maxChannelScrollY));
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Shader compile error: ' + info);
        }
        return shader;
    }

    _linkProgram(vs, fs) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error('Program link error: ' + info);
        }
        return program;
    }

    _initShaders() {
        const gl = this.gl;

        const waveVS = `#version 300 es
            precision highp float;

            uniform vec2 u_viewport_range;
            uniform float u_channel_index;
            uniform float u_channel_count;
            uniform float u_sfreq;
            uniform float u_time_offset;
            uniform float u_sensitivity;
            uniform float u_y_offset;
            uniform float u_fixed_mode;
            uniform float u_channel_pixel_height;
            uniform float u_canvas_height;
            uniform float u_y_scroll;

            in float a_sample;

            out vec2 v_pos;

            void main() {
                float t = float(gl_VertexID) / u_sfreq + u_time_offset;
                float x = (t - u_viewport_range.x) / (u_viewport_range.y - u_viewport_range.x);

                float y;
                if (u_fixed_mode > 0.5) {
                    float ch = u_channel_pixel_height / u_canvas_height;
                    float channel_center = 1.0 - (u_channel_index + 0.5) * ch + u_y_scroll;
                    y = channel_center + a_sample * ch * 0.45 * u_sensitivity + u_y_offset;
                } else {
                    float raw_h = 1.0 / u_channel_count;
                    float amp = raw_h * 0.45 * u_sensitivity;
                    float pad = min(amp, 0.02);
                    float usable = 1.0 - 2.0 * pad;
                    float ch = usable / u_channel_count;
                    float channel_center = (1.0 - pad) - (u_channel_index + 0.5) * ch;
                    y = channel_center + a_sample * ch * 0.45 * u_sensitivity + u_y_offset;
                }

                v_pos = vec2(x, y);
                gl_Position = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
            }
        `;

        const waveFS = `#version 300 es
            precision highp float;

            uniform vec4 u_color;
            in vec2 v_pos;
            out vec4 fragColor;

            void main() {
                fragColor = u_color;
            }
        `;

        const waveVSCompiled = this._compileShader(gl.VERTEX_SHADER, waveVS);
        const waveFSCompiled = this._compileShader(gl.FRAGMENT_SHADER, waveFS);
        this.waveProgram = this._linkProgram(waveVSCompiled, waveFSCompiled);

        this.uViewportRange = gl.getUniformLocation(this.waveProgram, 'u_viewport_range');
        this.uChannelIndex = gl.getUniformLocation(this.waveProgram, 'u_channel_index');
        this.uChannelCount = gl.getUniformLocation(this.waveProgram, 'u_channel_count');
        this.uSfreq = gl.getUniformLocation(this.waveProgram, 'u_sfreq');
        this.uTimeOffset = gl.getUniformLocation(this.waveProgram, 'u_time_offset');
        this.uColor = gl.getUniformLocation(this.waveProgram, 'u_color');
        this.uSensitivity = gl.getUniformLocation(this.waveProgram, 'u_sensitivity');
        this.uYOffset = gl.getUniformLocation(this.waveProgram, 'u_y_offset');
        this.uFixedMode = gl.getUniformLocation(this.waveProgram, 'u_fixed_mode');
        this.uChannelPixelHeight = gl.getUniformLocation(this.waveProgram, 'u_channel_pixel_height');
        this.uCanvasHeight = gl.getUniformLocation(this.waveProgram, 'u_canvas_height');
        this.uYScroll = gl.getUniformLocation(this.waveProgram, 'u_y_scroll');

        const gridVS = `#version 300 es
            precision highp float;
            in vec2 a_pos;
            void main() {
                gl_Position = vec4(a_pos, 0.0, 1.0);
            }
        `;

        const gridFS = `#version 300 es
            precision highp float;
            uniform vec4 u_grid_color;
            out vec4 fragColor;
            void main() {
                fragColor = u_grid_color;
            }
        `;

        const gridVSCompiled = this._compileShader(gl.VERTEX_SHADER, gridVS);
        const gridFSCompiled = this._compileShader(gl.FRAGMENT_SHADER, gridFS);
        this.gridProgram = this._linkProgram(gridVSCompiled, gridFSCompiled);
        this.uGridColor = gl.getUniformLocation(this.gridProgram, 'u_grid_color');

        const annoVS = `#version 300 es
            precision highp float;
            in vec2 a_pos;
            uniform vec2 u_viewport_range;
            void main() {
                float x = (a_pos.x - u_viewport_range.x) /
                          (u_viewport_range.y - u_viewport_range.x) * 2.0 - 1.0;
                gl_Position = vec4(x, a_pos.y, 0.0, 1.0);
            }
        `;

        const annoFS = `#version 300 es
            precision highp float;
            uniform vec4 u_anno_color;
            out vec4 fragColor;
            void main() {
                fragColor = u_anno_color;
            }
        `;

        const annoVSCompiled = this._compileShader(gl.VERTEX_SHADER, annoVS);
        const annoFSCompiled = this._compileShader(gl.FRAGMENT_SHADER, annoFS);
        this.annoProgram = this._linkProgram(annoVSCompiled, annoFSCompiled);
        this.uAnnoColor = gl.getUniformLocation(this.annoProgram, 'u_anno_color');
        this.uAnnoViewportRange = gl.getUniformLocation(this.annoProgram, 'u_viewport_range');
    }

    _initQuad() {
        const gl = this.gl;
        this.quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this.quadVAO);
    }

    _initAnnotationBuffers() {
        const gl = this.gl;
        this.annoVAO = gl.createVertexArray();
        this.annoVBO = gl.createBuffer();
        this.annoGroups = {};
        this.LABEL_COLORS = {
            'lvfa':        [0.2, 0.6, 1.0],
            'pre-ictal':   [1.0, 0.85, 0.2],
            'inter-ictal': [0.3, 0.85, 0.3],
            'ictal':       [1.0, 0.4, 0.3],
            'post-ictal':  [0.7, 0.4, 1.0],
            'other':       [0.6, 0.6, 0.6],
        };

        // 预览色带的 VAO 和 VBO
        this.previewVAO = gl.createVertexArray();
        this.previewVBO = gl.createBuffer();
    }

    _setupInteraction() {
        const canvas = this.canvas;

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            if (e.ctrlKey) {
                const range = this.viewportEnd - this.viewportStart;
                const delta = e.deltaY > 0 ? 1.1 : 0.9;
                const newRange = Math.max(1, Math.min(this.totalDuration, range * delta));

                const rect = canvas.getBoundingClientRect();
                const mouseX = (e.clientX - rect.left) / rect.width;
                const mouseTime = this.viewportStart + mouseX * range;

                this.viewportStart = mouseTime - (mouseTime - this.viewportStart) * (newRange / range);
                this.viewportEnd = this.viewportStart + newRange;
            } else {
                const range = this.viewportEnd - this.viewportStart;
                const scrollStep = range * 0.15;
                const dt = e.deltaY > 0 ? scrollStep : -scrollStep;

                this.viewportStart += dt;
                this.viewportEnd += dt;
            }

            if (this.viewportStart < 0) {
                this.viewportEnd -= this.viewportStart;
                this.viewportStart = 0;
            }
            if (this.viewportEnd > this.totalDuration) {
                this.viewportStart -= (this.viewportEnd - this.totalDuration);
                this.viewportEnd = this.totalDuration;
            }

            this.render();
            this._notifyViewportChange();
        }, { passive: false });

        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0 && !this.fixedHeightMode) {
                this.dragging = true;
                this.lastMouseX = e.clientX;
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!this.dragging) return;
            const dx = e.clientX - this.lastMouseX;
            this.lastMouseX = e.clientX;

            const range = this.viewportEnd - this.viewportStart;
            const dt = -dx / this.canvas.clientWidth * range;

            this.viewportStart += dt;
            this.viewportEnd += dt;

            if (this.viewportStart < 0) {
                this.viewportEnd -= this.viewportStart;
                this.viewportStart = 0;
            }
            if (this.viewportEnd > this.totalDuration) {
                this.viewportStart -= (this.viewportEnd - this.totalDuration);
                this.viewportEnd = this.totalDuration;
            }

            this.render();
            this._notifyViewportChange();
            if (this.onDrag) this.onDrag();
        });

        canvas.addEventListener('mouseup', () => { this.dragging = false; });
        canvas.addEventListener('mouseleave', () => { this.dragging = false; });

        window.addEventListener('resize', () => {
            this._resize();
            this.render();
        });
    }

    _notifyViewportChange() {
        if (this.onViewportChange) {
            this.onViewportChange(this.viewportStart, this.viewportEnd);
        }
    }

    _resize() {
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.round(rect.width * this.dpr);
        const h = Math.round(rect.height * this.dpr);
        if (this.canvas.width === w && this.canvas.height === h) return;
        this.canvas.width = w;
        this.canvas.height = h;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this._resizeTimeAxis();

        // 窗口大小改变时重新计算标注位置
        if (this._cachedAnnotations && this._cachedAnnotations.length > 0) {
            this.setAnnotations(this._cachedAnnotations);
        }
    }

    setChannels(channels, sfreq, totalDuration) {
        const gl = this.gl;

        for (const vbo of this.channelVBOs) {
            gl.deleteBuffer(vbo);
        }

        this._resize();

        this.channels = channels;
        this.sfreq = sfreq;
        this.totalDuration = totalDuration;
        this.channelVBOs = [];
        this.channelSampleCounts = [];
        this.channelSfreqs = [];

        for (const ch of channels) {
            const normalized = this._normalizeChannel(ch);
            const vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, normalized, gl.STATIC_DRAW);
            this.channelVBOs.push(vbo);
            this.channelSampleCounts.push(normalized.length);
            this.channelSfreqs.push(ch.sfreq || sfreq);
        }

        this.viewportStart = 0;
        this.viewportEnd = Math.min(10, totalDuration);
        this._notifyViewportChange();
    }

    _normalizeChannel(ch) {
        const data = ch.data;
        const len = data.length;
        if (len === 0) return new Float32Array(0);

        let pMin = ch.physicalMin;
        let pMax = ch.physicalMax;

        if (pMin === pMax || isNaN(pMin) || isNaN(pMax)) {
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < len; i++) {
                if (data[i] < min) min = data[i];
                if (data[i] > max) max = data[i];
            }
            pMin = min;
            pMax = max;
        }

        const range = pMax - pMin;
        if (range === 0) {
            return new Float32Array(len);
        }

        const normalized = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            normalized[i] = ((data[i] - pMin) / range) * 2.0 - 1.0;
        }
        return normalized;
    }

    setSensitivity(value) {
        this.sensitivity = value;
        this.render();
    }

    setViewport(start, end) {
        this.viewportStart = Math.max(0, start);
        this.viewportEnd = Math.min(this.totalDuration, end);
        this.render();
        this._notifyViewportChange();
    }

    setViewportDuration(duration) {
        const center = (this.viewportStart + this.viewportEnd) / 2;
        const half = duration / 2;
        this.viewportStart = Math.max(0, center - half);
        this.viewportEnd = this.viewportStart + duration;
        if (this.viewportEnd > this.totalDuration) {
            this.viewportEnd = this.totalDuration;
            this.viewportStart = Math.max(0, this.viewportEnd - duration);
        }
        this.render();
        this._notifyViewportChange();
    }

    setAnnotations(annotations) {
        // 缓存 annotations，用于 resize 时重新计算
        this._cachedAnnotations = annotations;

        const gl = this.gl;
        const groups = {};

        for (const ann of annotations) {
            const label = ann.label || 'other';
            if (!groups[label]) {
                groups[label] = { verts: [] };
            }
            const g = groups[label];

            // 使用 _computeAnnotationVerts 计算顶点
            const verts = this._computeAnnotationVerts(
                ann.start, ann.end, ann.originalChannel, label
            );
            if (verts.length > 0) {
                g.verts.push(...verts);
            }
        }

        this.annoGroups = {};
        let totalVerts = 0;

        for (const [label, g] of Object.entries(groups)) {
            const vertCount = g.verts.length / 2;
            const vertData = new Float32Array(g.verts);
            totalVerts += vertData.length;

            this.annoGroups[label] = {
                vertCount,
                offset: 0,
            };
        }

        if (totalVerts === 0) {
            gl.bindVertexArray(this.annoVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.annoVBO);
            gl.bufferData(gl.ARRAY_BUFFER, 4, gl.DYNAMIC_DRAW);
            gl.bindVertexArray(null);
            return;
        }

        const merged = new Float32Array(totalVerts);
        let vertOffset = 0;
        for (const [label, g] of Object.entries(groups)) {
            const vertData = new Float32Array(g.verts);
            this.annoGroups[label].offset = vertOffset / 2;
            merged.set(vertData, vertOffset);
            vertOffset += vertData.length;
        }

        gl.bindVertexArray(this.annoVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.annoVBO);
        gl.bufferData(gl.ARRAY_BUFFER, merged, gl.DYNAMIC_DRAW);

        const posLoc = gl.getAttribLocation(this.annoProgram, 'a_pos');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }

    setLabelColors(colors) {
        this.LABEL_COLORS = colors;
    }

    // 设置预览色带（实时跟随鼠标）
    setPreviewAnnotation(start, end, originalChannel, label) {
        this._previewAnnotation = { start, end, originalChannel, label };

        // 计算预览色带的顶点
        const verts = this._computeAnnotationVerts(
            start, end, originalChannel, label
        );
        if (verts.length === 0) {
            this.clearPreviewAnnotation();
            return;
        }

        const gl = this.gl;
        gl.bindVertexArray(this.previewVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.previewVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);

        const posLoc = gl.getAttribLocation(this.annoProgram, 'a_pos');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
        this.render();
    }

    // 清除预览色带
    clearPreviewAnnotation() {
        this._previewAnnotation = null;
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.previewVBO);
        // 清空缓冲区（0 字节表示空）
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
        this.render();
    }

    // 计算单个标注的顶点（供 setAnnotations 和 setPreviewAnnotation 共用）
    // 关键逻辑：根据 & 判断标注类型
    // - originalChannel 包含 & → 双极标注
    // - originalChannel 不包含 & → 单极标注
    // 单极模式：只显示单极标注
    // 双极模式：只显示双极标注
    // 注意：如果找不到对应通道，返回空数组（不显示色带）
    _computeAnnotationVerts(start, end, originalChannel, label) {
        const channelCount = this.channels.length;

        if (!originalChannel) {
            return [];
        }

        // 根据模式过滤标注类型
        const isBipolar = originalChannel.includes('&');
        if (this.showBipolarMode) {
            // 双极模式：只显示双极标注
            if (!isBipolar) {
                return [];
            }
        } else {
            // 单极模式：只显示单极标注
            if (isBipolar) {
                return [];
            }
        }

        // 如果没有通道，不显示色带
        if (channelCount === 0) {
            return [];
        }

        let chIndex = -1;

        if (isBipolar) {
            // 双极标注：从 bipolar 通道列表中查找匹配
            const parts = originalChannel.split('&');
            if (parts.length >= 2) {
                const ch1 = parts[0].trim();
                const ch2 = parts[1].trim();
                chIndex = this.channels.findIndex(ch => {
                    return (ch.ch1 === ch1 && ch.ch2 === ch2) ||
                           (ch.ch1 === ch2 && ch.ch2 === ch1);
                });
            }
        } else {
            // 单极标注：直接匹配通道名
            chIndex = this.channels.findIndex(ch => ch.name === originalChannel);

            // 策略2：去掉空格后匹配
            if (chIndex === -1) {
                const noSpace = originalChannel.replace(/\s+/g, '');
                chIndex = this.channels.findIndex(ch =>
                    ch.name === noSpace ||
                    ch.name.replace(/\s+/g, '') === noSpace
                );
            }

            // 策略3：模糊匹配
            if (chIndex === -1) {
                const noSpace = originalChannel.replace(/\s+/g, '');
                chIndex = this.channels.findIndex(ch => {
                    return ch.name.includes(noSpace) ||
                           noSpace.includes(ch.name.replace(/\s+/g, ''));
                });
            }
        }

        // 如果找不到对应通道，不显示色带
        if (chIndex < 0) {
            return [];
        }

        let yTop, yBottom;

        if (this.fixedHeightMode) {
            const ch = this.fixedChannelHeight / this.canvas.clientHeight;
            const yScrollNorm = this.channelScrollY / this.canvas.clientHeight;
            yTop = 1 - chIndex * ch + yScrollNorm;
            yBottom = 1 - (chIndex + 1) * ch + yScrollNorm;
        } else {
            const rawH = 1.0 / channelCount;
            const ampVal = rawH * 0.45 * this.sensitivity;
            const padClamped = Math.min(ampVal, 0.02);
            const usable = 1.0 - 2.0 * padClamped;
            const ch = usable / channelCount;
            yTop = (1.0 - padClamped) - chIndex * ch;
            yBottom = yTop - ch;
        }

        const yTopGL = yTop * 2 - 1;
        const yBottomGL = yBottom * 2 - 1;

        return [
            start, yTopGL, end, yTopGL, start, yBottomGL,
            start, yBottomGL, end, yTopGL, end, yBottomGL
        ];
    }

    getChannelAtMouse(mouseY) {
        if (this.channels.length === 0) return null;
        const rect = this.canvas.getBoundingClientRect();
        const y = (mouseY - rect.top) / rect.height;
        const channelCount = this.channels.length;

        let channelIndex;
        if (this.fixedHeightMode) {
            const ch = this.fixedChannelHeight / rect.height;
            const yScrollNorm = this.channelScrollY / rect.height;
            channelIndex = Math.floor((y + yScrollNorm) / ch);
        } else {
            const rawH = 1.0 / channelCount;
            const ampVal = rawH * 0.45 * this.sensitivity;
            const padClamped = Math.min(ampVal, 0.02);
            const usable = 1.0 - 2.0 * padClamped;
            const ch = usable / channelCount;
            const relY = (y - padClamped) / ch;
            channelIndex = Math.floor(relY);
        }

        if (channelIndex < 0 || channelIndex >= channelCount) return null;
        return this.channels[channelIndex].name;
    }

    getChannelDataAtMouse(mouseX, mouseY) {
        if (this.channels.length === 0) return null;
        const rect = this.canvas.getBoundingClientRect();
        const x = (mouseX - rect.left) / rect.width;
        const y = (mouseY - rect.top) / rect.height;
        const channelCount = this.channels.length;

        let channelIndex;
        let channelCenter;
        let ch;
        if (this.fixedHeightMode) {
            ch = this.fixedChannelHeight / rect.height;
            const yScrollNorm = this.channelScrollY / rect.height;
            channelIndex = Math.floor((y + yScrollNorm) / ch);
            channelCenter = 1.0 - (channelIndex + 0.5) * ch + yScrollNorm;
        } else {
            const rawH = 1.0 / channelCount;
            const ampVal = rawH * 0.45 * this.sensitivity;
            const padClamped = Math.min(ampVal, 0.02);
            const usable = 1.0 - 2.0 * padClamped;
            ch = usable / channelCount;
            channelIndex = Math.floor((y - padClamped) / ch);
            channelCenter = (1.0 - padClamped) - (channelIndex + 0.5) * ch;
        }

        if (channelIndex < 0 || channelIndex >= channelCount) return null;

        const time = this.viewportStart + x * (this.viewportEnd - this.viewportStart);
        const chSfreq = this.channelSfreqs[channelIndex] || this.sfreq;
        const sampleIndex = Math.round(time * chSfreq);
        const totalSamples = this.channelSampleCounts[channelIndex] || 0;
        if (sampleIndex < 0 || sampleIndex >= totalSamples) {
            return {
                channelName: this.channels[channelIndex].name,
                channelIndex: channelIndex,
                time: time,
                value: null,
                waveY: null
            };
        }

        const gl = this.gl;
        const vbo = this.channelVBOs[channelIndex];
        const tempBuf = new Float32Array(1);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.getBufferSubData(gl.ARRAY_BUFFER, sampleIndex * 4, tempBuf, 0, 1);

        const sampleVal = tempBuf[0];
        const waveY = channelCenter + sampleVal * ch * 0.45 * this.sensitivity;

        return {
            channelName: this.channels[channelIndex].name,
            channelIndex: channelIndex,
            time: time,
            value: sampleVal,
            waveY: waveY
        };
    }

    render() {
        const gl = this.gl;

        this._resize();

        if (this.channels.length === 0) {
            gl.clearColor(0.1, 0.1, 0.18, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            return;
        }

        gl.clearColor(0.1, 0.1, 0.18, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, 0, this.canvas.width, this.canvas.height);

        this._renderGrid();
        this._renderWaveforms();
        this._renderAnnotations();

        gl.disable(gl.SCISSOR_TEST);

        this._renderTimeAxis();
    }

    _renderGrid() {
        const gl = this.gl;
        const range = this.viewportEnd - this.viewportStart;

        let gridStep;
        if (range <= 5) gridStep = 0.5;
        else if (range <= 10) gridStep = 1;
        else if (range <= 30) gridStep = 5;
        else if (range <= 60) gridStep = 10;
        else if (range <= 300) gridStep = 30;
        else gridStep = 60;

        const lines = [];

        const startTick = Math.ceil(this.viewportStart / gridStep) * gridStep;
        for (let t = startTick; t <= this.viewportEnd; t += gridStep) {
            const x = (t - this.viewportStart) / range * 2 - 1;
            lines.push(x, -1, x, 1);
        }

        const channelCount = this.channels.length;
        if (channelCount > 0) {
            if (this.fixedHeightMode) {
                const ch = this.fixedChannelHeight / this.canvas.clientHeight;
                const yScrollNorm = this.channelScrollY / this.canvas.clientHeight;
                for (let i = 1; i < channelCount; i++) {
                    const yNorm = 1.0 - i * ch + yScrollNorm;
                    const y = yNorm * 2 - 1;
                    lines.push(-1, y, 1, y);
                }
            } else {
                const rawH = 1.0 / channelCount;
                const ampVal = rawH * 0.45 * this.sensitivity;
                const padClamped = Math.min(ampVal, 0.02);
                const usable = 1.0 - 2.0 * padClamped;
                const ch = usable / channelCount;
                for (let i = 1; i < channelCount; i++) {
                    const yNorm = (1.0 - padClamped) - i * ch;
                    const y = yNorm * 2 - 1;
                    lines.push(-1, y, 1, y);
                }
            }
        }

        if (lines.length === 0) return;

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);

        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const posLoc = gl.getAttribLocation(this.gridProgram, 'a_pos');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.useProgram(this.gridProgram);
        gl.uniform4f(this.uGridColor, 0.25, 0.25, 0.35, 1.0);
        gl.drawArrays(gl.LINES, 0, lines.length / 2);

        gl.deleteBuffer(vbo);
        gl.deleteVertexArray(vao);
        gl.bindVertexArray(null);
    }

    _renderAnnotations() {
        const gl = this.gl;

        gl.useProgram(this.annoProgram);
        gl.uniform2f(this.uAnnoViewportRange, this.viewportStart, this.viewportEnd);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // 绘制已保存的标注
        if (Object.keys(this.annoGroups).length > 0) {
            gl.bindVertexArray(this.annoVAO);

            for (const [label, group] of Object.entries(this.annoGroups)) {
                const color = this.LABEL_COLORS[label] || [0.6, 0.6, 0.6];

                if (group.vertCount > 0) {
                    gl.uniform4f(this.uAnnoColor, color[0], color[1], color[2], 0.25);
                    gl.drawArrays(gl.TRIANGLES, group.offset, group.vertCount);
                }
            }

            gl.bindVertexArray(null);
        }

        // 绘制预览色带（更亮的颜色，用虚线边缘效果）
        if (this._previewAnnotation) {
            const label = this._previewAnnotation.label || 'other';
            const color = this.LABEL_COLORS[label] || [0.6, 0.6, 0.6];

            gl.bindVertexArray(this.previewVAO);
            // 预览色带用更亮的颜色和更高的透明度
            gl.uniform4f(this.uAnnoColor, color[0], color[1], color[2], 0.45);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindVertexArray(null);
        }

        gl.disable(gl.BLEND);
    }

    _renderWaveforms() {
        const gl = this.gl;
        const channelCount = this.channels.length;
        if (channelCount === 0) return;

        gl.useProgram(this.waveProgram);
        gl.uniform2f(this.uViewportRange, this.viewportStart, this.viewportEnd);
        gl.uniform1f(this.uChannelCount, channelCount);
        gl.uniform1f(this.uSensitivity, this.sensitivity);

        if (this.fixedHeightMode) {
            gl.uniform1f(this.uFixedMode, 1.0);
            gl.uniform1f(this.uChannelPixelHeight, this.fixedChannelHeight);
            gl.uniform1f(this.uCanvasHeight, this.canvas.clientHeight);
            const yScrollNorm = this.channelScrollY / this.canvas.clientHeight;
            gl.uniform1f(this.uYScroll, yScrollNorm);
        } else {
            gl.uniform1f(this.uFixedMode, 0.0);
            gl.uniform1f(this.uChannelPixelHeight, 0.0);
            gl.uniform1f(this.uCanvasHeight, 0.0);
            gl.uniform1f(this.uYScroll, 0.0);
        }

        const pixelWidth = this.canvas.width;
        const range = this.viewportEnd - this.viewportStart;

        const colors = [
            [0.4, 0.85, 1.0],
            [1.0, 0.6, 0.4],
            [0.5, 1.0, 0.5],
            [1.0, 1.0, 0.4],
            [0.8, 0.5, 1.0],
            [1.0, 0.5, 0.8],
            [0.5, 1.0, 1.0],
            [1.0, 0.8, 0.5],
        ];

        for (let i = 0; i < channelCount; i++) {
            const chSfreq = this.channelSfreqs[i];
            gl.uniform1f(this.uSfreq, chSfreq);
            gl.uniform1f(this.uChannelIndex, i);

            const isSelected = this.channels[i].name === this.selectedChannel;
            const color = colors[i % colors.length];

            if (isSelected) {
                gl.uniform4f(this.uColor, color[0], color[1], color[2], 1.0);
            } else {
                gl.uniform4f(this.uColor, color[0] * 0.6, color[1] * 0.6, color[2] * 0.6, 1.0);
            }

            const vbo = this.channelVBOs[i];
            const totalSamples = this.channelSampleCounts[i];

            const startSample = Math.max(0, Math.floor(this.viewportStart * chSfreq));
            const endSample = Math.min(totalSamples, Math.ceil(this.viewportEnd * chSfreq));
            const sampleCount = endSample - startSample;

            if (sampleCount <= 0) continue;

            gl.uniform1f(this.uTimeOffset, startSample / chSfreq);

            const samplesPerPixel = range * chSfreq / pixelWidth;

            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);

            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            const posLoc = gl.getAttribLocation(this.waveProgram, 'a_sample');
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 1, gl.FLOAT, false, 0, startSample * 4);

            const offsets = isSelected
                ? [-0.0004, 0, 0.0004]
                : [0];

            for (const off of offsets) {
                gl.uniform1f(this.uYOffset, off);

                if (samplesPerPixel > 2) {
                    const numSegments = Math.ceil(pixelWidth);
                    const samplesPerSegment = Math.ceil(sampleCount / numSegments);
                    for (let s = 0; s < numSegments; s++) {
                        const segStart = s * samplesPerSegment;
                        const segCount = Math.min(samplesPerSegment, sampleCount - segStart);
                        if (segCount <= 0) break;
                        gl.drawArrays(gl.LINE_STRIP, segStart, segCount);
                    }
                } else {
                    gl.drawArrays(gl.LINE_STRIP, 0, sampleCount);
                }
            }

            gl.deleteVertexArray(vao);
        }

        gl.bindVertexArray(null);
    }

    getTimeAtMouse(mouseX) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (mouseX - rect.left) / rect.width;
        return this.viewportStart + x * (this.viewportEnd - this.viewportStart);
    }

    destroy() {
        const gl = this.gl;
        for (const vbo of this.channelVBOs) {
            gl.deleteBuffer(vbo);
        }
        gl.deleteProgram(this.waveProgram);
        gl.deleteProgram(this.gridProgram);
        gl.deleteProgram(this.annoProgram);
        gl.deleteVertexArray(this.quadVAO);
        gl.deleteVertexArray(this.annoVAO);
        gl.deleteBuffer(this.annoVBO);
    }

    _resizeTimeAxis() {
        if (!this.timeAxisCanvas) return;
        const dpr = window.devicePixelRatio || 1;
        const h = 32;
        const overviewH = 40;
        // 获取 canvas-container 的总宽度
        const container = this.canvas.parentElement;
        const containerW = container.clientWidth;
        // 获取 channel-labels 的宽度
        const channelLabels = document.getElementById('channel-labels');
        const labelW = channelLabels ? channelLabels.clientWidth : 0;
        // 获取拖拽分隔条的宽度
        const resizer = document.getElementById('channel-resizer');
        const resizerW = resizer ? resizer.clientWidth : 0;
        // time-axis-canvas 宽度 = container宽度 - label宽度 - 分隔条宽度
        const w = containerW - labelW - resizerW;
        this.timeAxisCanvas.width = w * dpr;
        this.timeAxisCanvas.height = h * dpr;
        this.timeAxisCanvas.style.width = w + 'px';
        this.timeAxisCanvas.style.height = h + 'px';
        this.timeAxisCanvas.style.left = (labelW + resizerW) + 'px';

        // 概览条尺寸同步（占满全宽）
        const overviewCanvas = document.getElementById('overview-canvas');
        const overviewVisible = overviewCanvas &&
            overviewCanvas.classList.contains('visible');
        if (overviewCanvas) {
            overviewCanvas.width = containerW * dpr;
            overviewCanvas.height = overviewH * dpr;
            overviewCanvas.style.width = containerW + 'px';
            overviewCanvas.style.height = overviewH + 'px';
            overviewCanvas.style.left = '0px';
        }

        // 让 canvas-container 为 time-axis + overview 预留空间
        container.style.paddingBottom = overviewVisible
            ? (h + overviewH) + 'px' : h + 'px';
    }

    _renderTimeAxis() {
        if (!this.timeAxisCtx) return;
        const ctx = this.timeAxisCtx;
        const canvas = this.timeAxisCanvas;
        const dpr = window.devicePixelRatio || 1;
        const range = this.viewportEnd - this.viewportStart;
        // 与 _resizeTimeAxis 保持一致，使用 canvas.width / dpr 作为实际渲染宽度
        const w = canvas.width / dpr;
        const h = 32;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background
        ctx.fillStyle = 'rgba(10, 15, 30, 0.9)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Determine tick step (same logic as grid)
        let tickStep;
        if (range <= 5) tickStep = 0.5;
        else if (range <= 10) tickStep = 1;
        else if (range <= 30) tickStep = 5;
        else if (range <= 60) tickStep = 10;
        else if (range <= 300) tickStep = 30;
        else tickStep = 60;

        const startTick = Math.ceil(this.viewportStart / tickStep) * tickStep;
        ctx.strokeStyle = 'rgba(100, 130, 180, 0.7)';
        ctx.lineWidth = 1;
        ctx.font = `${10 * dpr}px 'Cascadia Code', 'Consolas', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let t = startTick; t <= this.viewportEnd; t += tickStep) {
            const x = ((t - this.viewportStart) / range) * w * dpr;
            // Tick line
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 6 * dpr);
            ctx.stroke();
            // Time label
            const label = this._formatTimeLabel(t);
            ctx.fillStyle = 'rgba(160, 180, 210, 0.9)';
            ctx.fillText(label, x, (18) * dpr);
        }

        // Top border line
        ctx.strokeStyle = 'rgba(100, 130, 180, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0.5);
        ctx.lineTo(canvas.width, 0.5);
        ctx.stroke();
    }

    _formatTimeLabel(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${s % 1 === 0 ? String(s).padStart(2, '0') : s.toFixed(1)}`;
        }
        return `${m}:${String(s).padStart(2, '0')}`;
    }
}

window.GLRenderer = GLRenderer;
