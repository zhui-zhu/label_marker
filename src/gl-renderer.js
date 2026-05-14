class GLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
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

        this._initShaders();
        this._initQuad();
        this._initAnnotationBuffers();
        this._setupInteraction();
        this._resize();
    }

    setSelectedChannel(name) {
        this.selectedChannel = name;
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

            in float a_sample;

            out vec2 v_pos;

            void main() {
                float t = float(gl_VertexID) / u_sfreq + u_time_offset;
                float x = (t - u_viewport_range.x) / (u_viewport_range.y - u_viewport_range.x);

                float raw_h = 1.0 / u_channel_count;
                float amp = raw_h * 0.45 * u_sensitivity;
                float pad = min(amp, 0.02);
                float usable = 1.0 - 2.0 * pad;
                float ch = usable / u_channel_count;
                float channel_center = (1.0 - pad) - (u_channel_index + 0.5) * ch;
                float y = channel_center + a_sample * ch * 0.45 * u_sensitivity + u_y_offset;

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
            if (e.button === 0) {
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

        for (const ch of channels) {
            const normalized = this._normalizeChannel(ch);
            const vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, normalized, gl.STATIC_DRAW);
            this.channelVBOs.push(vbo);
            this.channelSampleCounts.push(normalized.length);
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
        const gl = this.gl;
        const fillVerts = [];
        const bandVerts = [];
        const bandH = 0.04;

        for (const ann of annotations) {
            const x1 = ann.start;
            const x2 = ann.end;
            fillVerts.push(
                x1, -1, x2, -1, x1, 1,
                x1, 1, x2, -1, x2, 1
            );
            bandVerts.push(
                x1, -1, x2, -1, x1, -1 + bandH,
                x1, -1 + bandH, x2, -1, x2, -1 + bandH,
                x1, 1 - bandH, x2, 1 - bandH, x1, 1,
                x1, 1, x2, 1 - bandH, x2, 1
            );
        }

        this.annoFillCount = fillVerts.length / 2;
        this.annoBandCount = bandVerts.length / 2;

        if (this.annoFillCount === 0 && this.annoBandCount === 0) {
            gl.bindVertexArray(this.annoVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.annoVBO);
            gl.bufferData(gl.ARRAY_BUFFER, 4, gl.DYNAMIC_DRAW);
            gl.bindVertexArray(null);
            return;
        }

        const allVerts = fillVerts.concat(bandVerts);
        const vertData = new Float32Array(allVerts);

        gl.bindVertexArray(this.annoVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.annoVBO);
        gl.bufferData(gl.ARRAY_BUFFER, vertData, gl.DYNAMIC_DRAW);

        const posLoc = gl.getAttribLocation(this.annoProgram, 'a_pos');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }

    getChannelAtMouse(mouseY) {
        if (this.channels.length === 0) return null;
        const rect = this.canvas.getBoundingClientRect();
        const y = (mouseY - rect.top) / rect.height;
        const channelCount = this.channels.length;
        const rawH = 1.0 / channelCount;
        const ampVal = rawH * 0.45 * this.sensitivity;
        const padClamped = Math.min(ampVal, 0.02);
        const usable = 1.0 - 2.0 * padClamped;
        const ch = usable / channelCount;
        const relY = (y - padClamped) / ch;
        const channelIndex = Math.floor(relY);
        if (channelIndex < 0 || channelIndex >= channelCount) return null;
        return this.channels[channelIndex].name;
    }

    getChannelDataAtMouse(mouseX, mouseY) {
        if (this.channels.length === 0) return null;
        const rect = this.canvas.getBoundingClientRect();
        const x = (mouseX - rect.left) / rect.width;
        const y = (mouseY - rect.top) / rect.height;
        const channelCount = this.channels.length;
        const rawH = 1.0 / channelCount;
        const ampVal = rawH * 0.45 * this.sensitivity;
        const padClamped = Math.min(ampVal, 0.02);
        const usable = 1.0 - 2.0 * padClamped;
        const ch = usable / channelCount;
        const channelIndex = Math.floor((y - padClamped) / ch);
        if (channelIndex < 0 || channelIndex >= channelCount) return null;

        const time = this.viewportStart + x * (this.viewportEnd - this.viewportStart);
        const sampleIndex = Math.round(time * this.sfreq);
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
        const channelCenter = (1.0 - padClamped) - (channelIndex + 0.5) * ch;
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
        if ((!this.annoFillCount || this.annoFillCount === 0) &&
            (!this.annoBandCount || this.annoBandCount === 0)) return;

        const gl = this.gl;

        gl.useProgram(this.annoProgram);
        gl.uniform2f(this.uAnnoViewportRange, this.viewportStart, this.viewportEnd);

        gl.bindVertexArray(this.annoVAO);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        if (this.annoFillCount > 0) {
            gl.uniform4f(this.uAnnoColor, 1.0, 0.4, 0.3, 0.25);
            gl.drawArrays(gl.TRIANGLES, 0, this.annoFillCount);
        }

        if (this.annoBandCount > 0) {
            gl.uniform4f(this.uAnnoColor, 1.0, 0.4, 0.3, 0.9);
            gl.drawArrays(gl.TRIANGLES, this.annoFillCount, this.annoBandCount);
        }

        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
    }

    _renderWaveforms() {
        const gl = this.gl;
        const channelCount = this.channels.length;
        if (channelCount === 0) return;

        gl.useProgram(this.waveProgram);
        gl.uniform2f(this.uViewportRange, this.viewportStart, this.viewportEnd);
        gl.uniform1f(this.uChannelCount, channelCount);
        gl.uniform1f(this.uSfreq, this.sfreq);
        gl.uniform1f(this.uSensitivity, this.sensitivity);

        const pixelWidth = this.canvas.width;
        const range = this.viewportEnd - this.viewportStart;
        const samplesPerPixel = range * this.sfreq / pixelWidth;

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

            const startSample = Math.max(0, Math.floor(this.viewportStart * this.sfreq));
            const endSample = Math.min(totalSamples, Math.ceil(this.viewportEnd * this.sfreq));
            const sampleCount = endSample - startSample;

            if (sampleCount <= 0) continue;

            gl.uniform1f(this.uTimeOffset, startSample / this.sfreq);

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
}

window.GLRenderer = GLRenderer;
