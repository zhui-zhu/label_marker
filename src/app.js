class App {
    constructor() {
        this.edfData = null;
        this.channels = [];
        this.selectedChannels = [];
        this.renderer = null;
        this.annotations = [];
        this.currentFile = null;
        this.sfreq = 0;
        this.duration = 0;
        this.annotationMode = false;
        this.annoStart = null;
        this.annoStartTime = null;
        this.annoEndTime = null;
        this.channelPanelVisible = false;
        this.filterBadChannels = false;
        this.annoPanelVisible = false;
        this.selectedAnnoChannel = null;
        this.annoStep = 0;
        this.badChannels = new Map();
        this.sensitivityUv = 100;
        this.originalChannels = null;
        this.recordingStart = null;
        this._lasso = null;
        this.undoStack = [];
        this.redoStack = [];
        this._autosaveTimer = null;
        this._confirmResolver = null;

        // 标注类型管理器
        this._labelTypes = this._loadLabelTypes();

        this._initRenderer();
        this._bindEvents();
        this._bindElectronAPI();
        this._updateLabelSelect();
        this._updateStepUI();
    }

    // 标注类型默认配置
    static DEFAULT_LABEL_TYPES = [
        { id: 'lvfa', name: 'LVFA', color: [0.2, 0.6, 1.0] },
        { id: 'pre-ictal', name: '发作前期', color: [1.0, 0.85, 0.2] },
        { id: 'inter-ictal', name: '发作间期', color: [0.3, 0.85, 0.3] },
        { id: 'ictal', name: '发作期', color: [1.0, 0.4, 0.3] },
        { id: 'post-ictal', name: '发作后期', color: [0.7, 0.4, 1.0] },
        { id: 'other', name: '其他', color: [0.6, 0.6, 0.6] },
    ];

    // 添加标注类型时的可选颜色（固定列表，不会和默认颜色重复）
    static NEW_LABEL_COLORS = [
        [0.2, 0.8, 0.8],   // 青色
        [1.0, 0.6, 0.2],   // 橙色
        [1.0, 0.4, 0.8],   // 粉色
        [0.4, 0.9, 0.5],   // 浅绿
        [0.9, 0.3, 0.3],   // 深红
        [0.3, 0.7, 0.9],   // 天蓝
        [0.5, 0.3, 0.9],   // 靛蓝
        [0.3, 0.9, 0.7],   // 薄荷绿
        [0.9, 0.5, 0.7],   // 玫瑰
        [0.7, 0.9, 0.3],   // 酸橙
        [0.4, 0.5, 0.9],   // 钴蓝
        [0.9, 0.85, 0.5],  // 奶油色
        [0.5, 0.8, 0.9],   // 浅蓝
        [0.98, 0.8, 0.77], // 珊瑚
        [0.78, 0.94, 0.78], // 薄荷
        [0.75, 0.75, 0.98], // 薰衣草
        [0.95, 0.8, 0.98],  // 浅紫
        [0.95, 0.6, 0.6],   // 印度红
    ];

    // 颜色选择器用的完整色板
    static LABEL_COLOR_PALETTE = [
        // 第一组：基本色
        [1.0, 0.4, 0.3],   // 红色
        [0.3, 0.85, 0.3],  // 绿色
        [0.2, 0.6, 1.0],   // 蓝色
        [1.0, 0.85, 0.2],  // 黄色
        [0.7, 0.4, 1.0],   // 紫色
        [0.2, 0.8, 0.8],   // 青色
        [1.0, 0.6, 0.2],   // 橙色
        [0.6, 0.6, 0.6],   // 灰色
        [1.0, 0.4, 0.8],   // 粉色
        [0.4, 0.9, 0.5],   // 浅绿
        // 第二组：扩展色
        [0.9, 0.3, 0.3],   // 深红
        [0.3, 0.7, 0.9],   // 天蓝
        [0.95, 0.7, 0.2],  // 金色
        [0.5, 0.3, 0.9],   // 靛蓝
        [0.3, 0.9, 0.7],   // 薄荷绿
        [0.9, 0.5, 0.7],   // 玫瑰
        [0.7, 0.9, 0.3],   // 酸橙
        [0.4, 0.5, 0.9],   // 钴蓝
        [0.9, 0.85, 0.5],  // 奶油色
        [0.5, 0.8, 0.9],   // 浅蓝
        // 第三组：柔和色
        [0.98, 0.8, 0.77], // 珊瑚
        [0.78, 0.94, 0.78], // 薄荷
        [0.75, 0.75, 0.98], // 薰衣草
        [0.98, 0.95, 0.75], // 杏色
        [0.75, 0.98, 0.95], // 浅绿松石
        [0.95, 0.8, 0.98],  // 浅紫
        [0.8, 0.98, 0.8],   // 浅绿
    ];

    _loadLabelTypes() {
        try {
            const saved = localStorage.getItem('labelTypes');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('加载标注类型配置失败:', e);
        }
        return JSON.parse(JSON.stringify(App.DEFAULT_LABEL_TYPES));
    }

    _saveLabelTypes() {
        try {
            localStorage.setItem('labelTypes', JSON.stringify(this._labelTypes));
        } catch (e) {
            console.warn('保存标注类型配置失败:', e);
        }
    }

    _updateLabelSelect() {
        const select = document.getElementById('anno-label');
        if (!select) return;
        select.innerHTML = '';
        for (const type of this._labelTypes) {
            const opt = document.createElement('option');
            opt.value = type.id;
            opt.textContent = type.name;
            select.appendChild(opt);
        }
    }

    _getLabelColor(labelId) {
        const type = this._labelTypes.find(t => t.id === labelId);
        return type ? type.color : [0.6, 0.6, 0.6];
    }

    // 自定义确认对话框（替代原生confirm，避免Electron焦点问题）
    _confirm(message, title = '确认') {
        return new Promise((resolve) => {
            const previousFocus = document.activeElement;
            const dialog = document.getElementById('confirm-dialog');
            document.getElementById('confirm-title').textContent = title;
            document.getElementById('confirm-message').textContent = message;
            dialog.classList.remove('hidden');

            const okBtn = document.getElementById('confirm-ok');
            const cancelBtn = document.getElementById('confirm-cancel');

            const cleanup = (result) => {
                dialog.classList.add('hidden');
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                // 恢复焦点到对话框打开前的元素
                // 避免焦点停留在已隐藏的按钮上，导致后续下拉框无法打开
                if (previousFocus && typeof previousFocus.focus === 'function') {
                    try {
                        previousFocus.focus();
                    } catch (e) {
                        // 焦点恢复失败时忽略
                    }
                }
                resolve(result);
            };

            okBtn.onclick = () => cleanup(true);
            cancelBtn.onclick = () => cleanup(false);
        });
    }

    _showLabelTypesPanel() {
        const modal = document.getElementById('label-types-modal');
        modal.classList.remove('hidden');
        this._renderLabelTypesList();
    }

    _hideLabelTypesPanel() {
        const modal = document.getElementById('label-types-modal');
        this._hideColorPicker();
        modal.classList.add('hidden');
        // 关闭面板后将焦点移到标注面板的下拉框
        // 避免焦点停留在已隐藏的元素上，导致select下拉框无法打开
        if (this.annoPanelVisible) {
            const annoLabel = document.getElementById('anno-label');
            if (annoLabel) {
                annoLabel.focus();
            }
        }
    }

    _renderLabelTypesList() {
        const container = document.getElementById('label-types-list');
        const n = this._labelTypes.length;
        
        // 使用 innerHTML 批量渲染，提高性能
        container.innerHTML = this._labelTypes.map((type, i) => {
            const colorRgb = `${type.color[0]*255},${type.color[1]*255},${type.color[2]*255}`;
            const upDisabled = i === 0 ? 'disabled' : '';
            const downDisabled = i === n - 1 ? 'disabled' : '';
            return `
                <div class="label-type-row" data-index="${i}">
                    <button class="btn-sm btn-move" data-action="up" data-index="${i}" title="上移" ${upDisabled}>↑</button>
                    <button class="btn-sm btn-move" data-action="down" data-index="${i}" title="下移" ${downDisabled}>↓</button>
                    <span class="label-color-dot" data-action="color" data-index="${i}" style="background-color: rgb(${colorRgb});"></span>
                    <span class="label-type-name" data-action="edit" data-index="${i}">${type.name}</span>
                    <button class="btn-sm" data-action="edit" data-index="${i}">编辑</button>
                    <button class="btn-sm btn-danger" data-action="delete" data-index="${i}">删除</button>
                </div>
            `;
        }).join('');

        // 使用事件委托处理点击
        container.onclick = (e) => {
            const action = e.target.dataset.action;
            const index = parseInt(e.target.dataset.index);
            if (action === 'up') this._moveLabelType(index, -1);
            else if (action === 'down') this._moveLabelType(index, 1);
            else if (action === 'color') this._showColorPicker(index, e);
            else if (action === 'edit') this._editLabelTypeName(index);
            else if (action === 'delete') this._deleteLabelType(index);
        };

        // 双击编辑名称
        container.ondblclick = (e) => {
            if (e.target.classList.contains('label-type-name')) {
                const index = parseInt(e.target.dataset.index);
                this._editLabelTypeName(index);
            }
        };
    }

    _showColorPicker(index, e) {
        const type = this._labelTypes[index];
        let picker = document.getElementById('color-picker');
        if (!picker) {
            picker = document.createElement('div');
            picker.id = 'color-picker';
            picker.className = 'color-picker-popup hidden';
            document.body.appendChild(picker);
        }

        picker.innerHTML = App.LABEL_COLOR_PALETTE.map((color, i) => 
            `<button class="color-picker-btn" data-color-index="${i}" style="background-color: rgb(${color[0]*255},${color[1]*255},${color[2]*255});"></button>`
        ).join('');

        // 点击色板内部按钮选择颜色
        picker.onclick = (ev) => {
            ev.stopPropagation();
            const colorIndex = parseInt(ev.target.dataset.colorIndex);
            if (!isNaN(colorIndex)) {
                this._labelTypes[index].color = App.LABEL_COLOR_PALETTE[colorIndex];
                this._saveLabelTypes();
                this._renderLabelTypesList();
                this._applyLabelColors();
                this._hideColorPicker();
            }
        };

        const rect = e.target.getBoundingClientRect();
        picker.style.top = (rect.bottom + 5) + 'px';
        picker.style.left = rect.left + 'px';
        picker.classList.remove('hidden');

        // 点击色板外部关闭
        const hidePicker = (ev) => {
            if (!picker.contains(ev.target)) {
                this._hideColorPicker();
                document.removeEventListener('click', hidePicker);
            }
        };
        setTimeout(() => document.addEventListener('click', hidePicker), 0);
    }

    _hideColorPicker() {
        const picker = document.getElementById('color-picker');
        if (picker) picker.classList.add('hidden');
    }

    _editLabelTypeName(index) {
        const type = this._labelTypes[index];
        const nameSpan = document.querySelectorAll('.label-type-name')[index];
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'label-name-input';
        input.value = type.name;
        input.maxLength = 20;

        const finish = () => {
            const newName = input.value.trim();
            if (newName) {
                type.name = newName;
                this._saveLabelTypes();
                this._updateLabelSelect();
                this._renderLabelTypesList();
            } else {
                this._renderLabelTypesList();
            }
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') this._renderLabelTypesList();
        });

        nameSpan.replaceWith(input);
        input.focus();
        input.select();
    }

    _editLabelType(index) {
        this._editLabelTypeName(index);
    }

    async _deleteLabelType(index) {
        if (this._labelTypes.length <= 1) {
            this._setStatus('至少需要保留一个标注类型', 'warning');
            return;
        }
        const type = this._labelTypes[index];
        const ok = await this._confirm(`确定删除标注类型"${type.name}"吗？`, '删除确认');
        if (ok) {
            this._labelTypes.splice(index, 1);
            this._saveLabelTypes();
            this._updateLabelSelect();
            this._renderLabelTypesList();
            this._applyLabelColors();
            this._setStatus(`已删除标注类型: ${type.name}`, 'info');
        }
    }

    _moveLabelType(index, direction) {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= this._labelTypes.length) return;

        const temp = this._labelTypes[index];
        this._labelTypes[index] = this._labelTypes[newIndex];
        this._labelTypes[newIndex] = temp;

        this._saveLabelTypes();
        this._updateLabelSelect();
        this._renderLabelTypesList();
    }

    _addLabelType() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-box" style="max-width: 340px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; font-size: 14px; color: var(--text-primary);">添加标注类型</h3>
                <input type="text" id="new-label-type-name" class="form-input" 
                       placeholder="输入名称..." maxlength="20" style="width: 100%; margin-bottom: 12px;">
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">选择颜色:</div>
                    <div id="add-color-options" style="display: flex; gap: 6px; flex-wrap: wrap;"></div>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="cancel-add-type" class="btn btn-secondary" style="flex: 1;">取消</button>
                    <button id="confirm-add-type" class="btn btn-primary" style="flex: 1;">确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        let selectedColor = App.NEW_LABEL_COLORS[0];

        const input = modal.querySelector('#new-label-type-name');
        const colorContainer = modal.querySelector('#add-color-options');
        const confirmBtn = modal.querySelector('#confirm-add-type');
        const cancelBtn = modal.querySelector('#cancel-add-type');

        // 渲染颜色选项
        const renderColors = () => {
            colorContainer.innerHTML = '';
            for (const color of App.NEW_LABEL_COLORS) {
                const btn = document.createElement('button');
                btn.className = 'color-picker-btn';
                btn.style.backgroundColor = `rgb(${color[0]*255},${color[1]*255},${color[2]*255})`;
                if (color[0] === selectedColor[0] && color[1] === selectedColor[1] && color[2] === selectedColor[2]) {
                    btn.style.border = '2px solid white';
                }
                btn.addEventListener('click', () => {
                    selectedColor = color;
                    renderColors();
                });
                colorContainer.appendChild(btn);
            }
        };
        renderColors();

        input.focus();

        const closeAndAdd = () => {
            const name = input.value.trim();
            if (name) {
                let id = name.toLowerCase().replace(/\s+/g, '-');
                let counter = 1;
                while (this._labelTypes.find(t => t.id === id)) {
                    id = `${name.toLowerCase().replace(/\s+/g, '-')}-${counter++}`;
                }

                this._labelTypes.push({ id, name, color: selectedColor });
                this._saveLabelTypes();
                this._updateLabelSelect();
                this._renderLabelTypesList();
                this._applyLabelColors();
                this._setStatus(`已添加标注类型: ${name}`, 'success');
            }
            document.body.removeChild(modal);
        };

        confirmBtn.addEventListener('click', closeAndAdd);
        cancelBtn.addEventListener('click', () => document.body.removeChild(modal));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') closeAndAdd();
            if (e.key === 'Escape') document.body.removeChild(modal);
        });
    }

    async _resetLabelTypes() {
        const ok = await this._confirm('确定重置为默认标注类型吗？所有自定义类型将被删除。', '重置确认');
        if (ok) {
            this._labelTypes = JSON.parse(JSON.stringify(App.DEFAULT_LABEL_TYPES));
            this._saveLabelTypes();
            this._updateLabelSelect();
            this._renderLabelTypesList();
            this._applyLabelColors();
            this._setStatus('已重置为默认标注类型', 'info');
        }
    }

    _applyLabelColors() {
        if (this.renderer) {
            const colors = {};
            for (const type of this._labelTypes) {
                colors[type.id] = type.color;
            }
            this.renderer.setLabelColors(colors);
        }
    }

    _initRenderer() {
        const canvas = document.getElementById('waveform-canvas');
        const timeAxisCanvas = document.getElementById('time-axis-canvas');
        this.renderer = new GLRenderer(canvas);
        this.renderer.setTimeAxisCanvas(timeAxisCanvas);

        this.renderer.onViewportChange = (start, end) => {
            this._updateTimeDisplay(start, end);
            this._updateLabelPositions();
            this._renderOverview();
        };

        this.renderer.onDrag = () => {
            this._hideTooltip();
        };

        document.getElementById('channel-labels').addEventListener(
            'wheel', (e) => e.preventDefault(), { passive: false }
        );
    }

    _bindElectronAPI() {
        if (!window.electronAPI) return;

        window.electronAPI.onFileOpened((data) => {
            const arrayBuffer = this._ensureArrayBuffer(data.data);
            this._loadEDFFromArrayBuffer(arrayBuffer, data.name, data.size);
        });

        window.electronAPI.onAnnotationsImported((data) => {
            this._importAnnotations(data.content);
        });

        window.electronAPI.onMenuExport(() => {
            this._exportAnnotations();
        });
    }

    _ensureArrayBuffer(data) {
        if (data instanceof ArrayBuffer) {
            return data;
        }
        if (ArrayBuffer.isView(data)) {
            return data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength
            );
        }
        if (data && typeof data === 'object' && data.buffer instanceof ArrayBuffer) {
            return data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength
            );
        }
        throw new Error(
            `无法转换为ArrayBuffer: type=${typeof data}, ` +
            `constructor=${data && data.constructor ? data.constructor.name : 'null'}`
        );
    }

    _bindEvents() {
        document.getElementById('btn-open').addEventListener('click', () => this._openFile());
        document.getElementById('btn-recent').addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleRecentFilesMenu();
        });
        document.addEventListener('click', () => this._hideRecentFilesMenu());
        document.getElementById('btn-export').addEventListener('click', () => this._exportAnnotations());
        document.getElementById('btn-import').addEventListener('click', () => this._importAnnotationsDialog());
        document.getElementById('btn-add-anno').addEventListener('click', () => this._addAnnotation());
        document.getElementById('btn-clear-annos').addEventListener('click', () => this._clearAnnotations());
        document.getElementById('btn-anno-mode').addEventListener('click', () => this._toggleAnnotationMode());
        document.getElementById('anno-channel').addEventListener('change', () => {
            const val = document.getElementById('anno-channel').value;
            this.selectedAnnoChannel = val || null;
            this.renderer.setSelectedChannel(val || null);
            this.renderer.render();
            this._updateStepUI();
        });
        document.getElementById('channel-search').addEventListener('input', () => this._filterChannels());
        document.getElementById('btn-filter-bad').addEventListener('click', () => this._toggleBadChannelFilter());
        document.getElementById('btn-select-all').addEventListener('click', () => this._selectAllChannels());
        document.getElementById('btn-deselect-all').addEventListener('click', () => this._deselectAllChannels());
        document.getElementById('btn-bipolar').addEventListener('click', () => this._toggleBipolar());
        document.getElementById('btn-fixed-height').addEventListener('click', () => this._toggleFixedHeight());
        document.getElementById('btn-fft').addEventListener('click', () => this._showFFTPanel());
        document.getElementById('btn-spectrogram').addEventListener('click', () => this._showSpectrogramPanel());
        document.getElementById('btn-bad-channels').addEventListener('click', () => this._showBadChannelsPanel());
        document.getElementById('btn-overview').addEventListener('click', () => this._toggleOverview());

        // 标注类型设置面板
        document.getElementById('btn-label-types').addEventListener('click', () => this._showLabelTypesPanel());
        document.getElementById('label-types-close').addEventListener('click', () => this._hideLabelTypesPanel());
        document.getElementById('btn-add-label-type').addEventListener('click', () => this._addLabelType());
        document.getElementById('btn-reset-label-types').addEventListener('click', () => this._resetLabelTypes());
        
        // 点击modal背景关闭
        document.getElementById('label-types-modal').addEventListener('click', (e) => {
            if (e.target.id === 'label-types-modal') this._hideLabelTypesPanel();
        });

        document.getElementById('btn-channels').addEventListener('click', () => this._toggleChannelPanel());
        document.getElementById('btn-close-channels').addEventListener('click', () => this._hideChannelPanel());

        document.getElementById('btn-anno').addEventListener('click', () => this._toggleAnnoPanel());
        document.getElementById('btn-close-anno').addEventListener('click', () => this._hideAnnoPanel());

        document.getElementById('sensitivity-select').addEventListener('change', (e) => {
            this._applySensitivity(parseInt(e.target.value));
        });

        document.getElementById('window-select').addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            this.renderer.setViewportDuration(val);
        });

        document.getElementById('goto-time').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const timeStr = e.target.value.trim();
                const parsed = this._parseTime(timeStr);
                if (parsed) {
                    const currentCenter = (this.renderer.viewportStart + this.renderer.viewportEnd) / 2;
                    const newCenter = parsed.type === 'add' ? currentCenter + parsed.value : parsed.value;
                    this._gotoTime(parsed);
                    e.target.value = '';
                    e.target.placeholder = this._formatTime(newCenter);
                }
            }
        });

        document.getElementById('notch-select').addEventListener('change', () => this._applyFilters());
        document.getElementById('highpass-select').addEventListener('change', () => this._applyFilters());
        document.getElementById('lowpass-select').addEventListener('change', () => this._applyFilters());

        document.getElementById('waveform-canvas').addEventListener('click', (e) => {
            if (this._wasDragging) {
                this._wasDragging = false;
                return;
            }
            this._handleCanvasClick(e);
        });

        document.getElementById('waveform-canvas').addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                this._handleCanvasMiddleClick(e);
            }
        });

        document.getElementById('waveform-canvas').addEventListener('mousedown', (e) => {
            if (e.button === 1) e.preventDefault();
            if (e.button === 0 && this.renderer.fixedHeightMode) {
                this._dragStartX = e.clientX;
                this._dragStartY = e.clientY;
                this._dragStartViewportStart = this.renderer.viewportStart;
                this._dragStartChannelScrollY = this.renderer.channelScrollY;
                this._isDragging = false;
                this._wasDragging = false;
            }
        });

        document.getElementById('waveform-canvas').addEventListener('mousemove', (e) => {
            if (this._isDragging || this._dragStartX !== undefined) {
                const dx = e.clientX - this._dragStartX;
                const dy = e.clientY - this._dragStartY;
                if (!this._isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                    this._isDragging = true;
                    this._wasDragging = true;
                }
                if (this._isDragging) {
                    const timeRange = this.renderer.viewportEnd - this.renderer.viewportStart;
                    const canvasWidth = this.renderer.canvas.clientWidth;
                    const timeDelta = -(dx / canvasWidth) * timeRange;
                    let newStart = this._dragStartViewportStart + timeDelta;
                    let newEnd = newStart + timeRange;
                    if (newStart < 0) { newStart = 0; newEnd = timeRange; }
                    if (newEnd > this.renderer.totalDuration) {
                        newEnd = this.renderer.totalDuration;
                        newStart = newEnd - timeRange;
                    }
                    this.renderer.viewportStart = newStart;
                    this.renderer.viewportEnd = newEnd;

                    const scrollDelta = -dy;
                    this.renderer.setChannelScrollY(
                        this._dragStartChannelScrollY + scrollDelta
                    );

                    this.renderer.render();
                    this._updateTimeDisplay(newStart, newEnd);
                    this._updateLabelPositions();
                    return;
                }
            }
            this._handleCanvasMouseMove(e);
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this._dragStartX = undefined;
                this._dragStartY = undefined;
                this._isDragging = false;
            }
        });

        document.getElementById('waveform-canvas').addEventListener('mouseleave', () => {
            this._hideTooltip();
        });

        document.getElementById('waveform-canvas').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._handleCanvasRightClick(e);
        });

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'Escape') {
                this.annotationMode = false;
                this.annoStart = null;
                this.annoStartTime = null;
                this.annoEndTime = null;
                document.getElementById('anno-start').value = '';
                document.getElementById('anno-end').value = '';
                this._updateAnnoModeButton();
                this._updateStepUI();
            }
            if (e.key === 'PageUp' && this.edfData) {
                e.preventDefault();
                this._panViewport(0.5);
            }
            if (e.key === 'PageDown' && this.edfData) {
                e.preventDefault();
                this._panViewport(-0.5);
            }
            if ((e.key === 'ArrowUp' || e.key === 'ArrowRight') && this.edfData) {
                e.preventDefault();
                this._panViewport(0.5);
            }
            if ((e.key === 'ArrowDown' || e.key === 'ArrowLeft') && this.edfData) {
                e.preventDefault();
                this._panViewport(-0.5);
            }
            if (e.key === ' ' && this.edfData) {
                e.preventDefault();
                this._panViewport(1);
            }
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                this._undo();
            }
            if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
                e.preventDefault();
                this._redo();
            }
        });

        const channelList = document.getElementById('channel-list');
        channelList.addEventListener('mousedown', (e) => this._onLassoStart(e));
        channelList.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('mousemove', (e) => this._onLassoMove(e));
        document.addEventListener('mouseup', (e) => this._onLassoEnd(e));

        // 拖拽文件打开
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                for (const file of files) {
                    const ext = file.name.split('.').pop().toLowerCase();
                    if (ext === 'edf' || ext === 'bdf') {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            this._loadEDFFromArrayBuffer(ev.target.result, file.name, file.size);
                        };
                        reader.readAsArrayBuffer(file);
                    } else {
                        this._setStatus(`不支持的文件类型: .${ext}`, 'error');
                    }
                }
            }
        });

        // 通道标签宽度拖拽调整
        this._initChannelResizer();
        this._initSpectrogramMouseInteraction();
        this._initOverviewInteraction();

        window.addEventListener('resize', () => {
            if (this.renderer) {
                this.renderer._resize();
                this.renderer.render();
                this._updateChannelLabels();
            }
        });
    }

    _initChannelResizer() {
        const resizer = document.getElementById('channel-resizer');
        const channelLabels = document.getElementById('channel-labels');
        if (!resizer || !channelLabels) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isResizing = true;
            startX = e.clientX;
            startWidth = channelLabels.offsetWidth;
            resizer.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            const newWidth = Math.min(400, Math.max(50, startWidth + dx));
            channelLabels.style.width = newWidth + 'px';
            // 同步调整渲染器画布尺寸
            if (this.renderer) {
                this.renderer._resize();
                this.renderer.render();
                this.renderer._resizeTimeAxis();
            }
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            resizer.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    }

    _toggleChannelPanel() {
        this.channelPanelVisible = !this.channelPanelVisible;
        const panel = document.getElementById('channel-panel');
        const btn = document.getElementById('btn-channels');
        if (this.channelPanelVisible) {
            panel.classList.remove('hidden');
            btn.classList.add('active');
        } else {
            panel.classList.add('hidden');
            btn.classList.remove('active');
        }
    }

    _hideChannelPanel() {
        this.channelPanelVisible = false;
        document.getElementById('channel-panel').classList.add('hidden');
        document.getElementById('btn-channels').classList.remove('active');
    }

    _toggleAnnoPanel() {
        this.annoPanelVisible = !this.annoPanelVisible;
        const panel = document.getElementById('anno-panel');
        const btn = document.getElementById('btn-anno');
        if (this.annoPanelVisible) {
            panel.classList.remove('hidden');
            btn.classList.add('active');
        } else {
            panel.classList.add('hidden');
            btn.classList.remove('active');
        }
    }

    _hideAnnoPanel() {
        this.annoPanelVisible = false;
        document.getElementById('anno-panel').classList.add('hidden');
        document.getElementById('btn-anno').classList.remove('active');
    }

    _showAnnoPanel() {
        this.annoPanelVisible = true;
        document.getElementById('anno-panel').classList.remove('hidden');
        document.getElementById('btn-anno').classList.add('active');
    }

    _handleCanvasMouseMove(e) {
        if (!this.edfData) return;
        const info = this.renderer.getChannelDataAtMouse(e.clientX, e.clientY);
        if (!info || info.waveY === null) {
            this._hideTooltip();
            return;
        }

        const canvasRect = document.getElementById('waveform-canvas').getBoundingClientRect();
        const mouseNormY = 1.0 - (e.clientY - canvasRect.top) / canvasRect.height;
        const dist = Math.abs(mouseNormY - info.waveY);
        const channelHeight = 1.0 / this.channels.length;
        const threshold = Math.max(channelHeight * 0.4, 0.02);
        if (dist > threshold) {
            this._hideTooltip();
            return;
        }

        const tooltip = document.getElementById('waveform-tooltip');
        const containerRect = document.getElementById('waveform-canvas').parentElement.getBoundingClientRect();

        const offsetX = e.clientX - containerRect.left + 12;
        const offsetY = e.clientY - containerRect.top - 10;

        const ch = this.channels.find(c => c.name === info.channelName);
        const bipolar = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels.find(c => c.name === info.channelName) : null;
        const channelData = ch || bipolar;

        let valueStr = '';
        if (info.value !== null && channelData) {
            const realValue = channelData.physicalMin +
                (info.value + 1) / 2 * (channelData.physicalMax - channelData.physicalMin);
            valueStr = `<span class="tt-value">${realValue.toFixed(2)} μV</span>`;
        }

        tooltip.innerHTML =
            `<span class="tt-channel">${info.channelName}</span> ` +
            `<span class="tt-time">${this._formatTime(info.time)}</span>` +
            (valueStr ? ` ${valueStr}` : '');

        tooltip.classList.remove('hidden');
        tooltip.style.left = offsetX + 'px';
        tooltip.style.top = offsetY + 'px';

        const tooltipRect = tooltip.getBoundingClientRect();
        if (tooltipRect.right > containerRect.right) {
            tooltip.style.left = (offsetX - tooltipRect.width - 24) + 'px';
        }
        if (tooltipRect.bottom > containerRect.bottom) {
            tooltip.style.top = (offsetY - tooltipRect.height) + 'px';
        }
    }

    _hideTooltip() {
        const tooltip = document.getElementById('waveform-tooltip');
        if (tooltip) tooltip.classList.add('hidden');
    }

    // 坏道类型定义
    static BAD_CHANNEL_TYPES = [
        { id: 'flat', name: '平坦', color: '#9e9e9e' },
        { id: 'noisy', name: '噪声', color: '#ff9800' },
        { id: 'drift', name: '漂移', color: '#2196f3' },
        { id: 'bridge', name: '桥接', color: '#9c27b0' },
        { id: 'jump', name: '跳变', color: '#f44336' },
        { id: 'other', name: '其他', color: '#607d8b' },
    ];

    _evaluateChannelQuality() {
        // 保留手动标记的坏道，仅重置自动检测的
        for (const [name, info] of this.badChannels) {
            if (info.reason === 'auto') {
                this.badChannels.delete(name);
            }
        }

        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;

        if (channels.length === 0) return;

        const stats = [];
        for (const ch of channels) {
            const data = ch.data;
            if (!data || data.length === 0) {
                this.badChannels.set(ch.name, {
                    reason: 'auto', type: 'flat', note: '无数据'
                });
                continue;
            }

            const len = data.length;
            let sum = 0, sumSq = 0;
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < len; i++) {
                const v = data[i];
                sum += v;
                sumSq += v * v;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            const mean = sum / len;
            const variance = sumSq / len - mean * mean;
            const std = Math.sqrt(Math.max(0, variance));
            const ptp = max - min;

            // 唯一值计数（检测平坦信号）
            const uniqueSet = new Set();
            for (let i = 0; i < len; i++) {
                uniqueSet.add(data[i]);
                if (uniqueSet.size > 10) break;
            }

            // 一阶差分统计（检测跳变/高频噪声）
            let diffSum = 0, diffMax = 0;
            for (let i = 1; i < len; i++) {
                const d = Math.abs(data[i] - data[i - 1]);
                diffSum += d;
                if (d > diffMax) diffMax = d;
            }
            const meanDiff = diffSum / (len - 1);

            // 直流偏移量（检测漂移）
            const absMean = Math.abs(mean);

            stats.push({
                name: ch.name, std, ptp, mean, absMean,
                uniqueCount: uniqueSet.size,
                meanDiff, diffMax, data
            });
        }

        if (stats.length === 0) return;

        const validStats = stats.filter(s => !this.badChannels.has(s.name));
        if (validStats.length === 0) return;

        // 计算中位数基准
        const stds = validStats.map(s => s.std).sort((a, b) => a - b);
        const medianStd = stds[Math.floor(stds.length / 2)];
        const ptps = validStats.map(s => s.ptp).sort((a, b) => a - b);
        const medianPtp = ptps[Math.floor(ptps.length / 2)];
        const diffs = validStats.map(s => s.meanDiff).sort((a, b) => a - b);
        const medianDiff = diffs[Math.floor(diffs.length / 2)];

        if (medianStd <= 0 || medianPtp <= 0) return;

        // 桥接检测：通道间相关系数
        const bridgePairs = this._detectBridgeChannels(validStats);

        for (const s of validStats) {
            const stdRatio = s.std / medianStd;
            const ptpRatio = s.ptp / medianPtp;
            const diffRatio = s.meanDiff / Math.max(1e-10, medianDiff);

            // 平坦信号
            if (s.uniqueCount <= 10) {
                this.badChannels.set(s.name, {
                    reason: 'auto', type: 'flat', note: '信号几乎无变化'
                });
                continue;
            }
            // 振幅过低
            if (stdRatio < 0.5 || ptpRatio < 0.5) {
                this.badChannels.set(s.name, {
                    reason: 'auto', type: 'flat', note: '振幅过低'
                });
                continue;
            }
            // 振幅过高（噪声或饱和）
            if (stdRatio > 50) {
                this.badChannels.set(s.name, {
                    reason: 'auto', type: 'noisy', note: '振幅异常高'
                });
                continue;
            }
            // 高频噪声：差分均值远高于中位数
            if (diffRatio > 10 && stdRatio > 3) {
                this.badChannels.set(s.name, {
                    reason: 'auto', type: 'noisy', note: '高频噪声'
                });
                continue;
            }
            // 直流漂移：均值偏移大
            if (s.absMean > medianPtp * 2 && stdRatio < 5) {
                this.badChannels.set(s.name, {
                    reason: 'auto', type: 'drift', note: '直流漂移'
                });
                continue;
            }
        }

        // 桥接检测结果
        for (const [name, info] of bridgePairs) {
            if (!this.badChannels.has(name)) {
                this.badChannels.set(name, info);
            }
        }
    }

    // 检测桥接通道（相关系数 > 0.99）
    _detectBridgeChannels(stats) {
        const result = new Map();
        if (stats.length < 2) return result;

        // 采样检测（数据量大时降采样以提高性能）
        const maxSamples = 5000;
        const sampledStats = stats.map(s => {
            const data = s.data;
            const len = data.length;
            if (len <= maxSamples) return s;
            const step = Math.floor(len / maxSamples);
            const sampled = new Float32Array(maxSamples);
            for (let i = 0; i < maxSamples; i++) {
                sampled[i] = data[i * step];
            }
            return { ...s, data: sampled };
        });

        for (let i = 0; i < sampledStats.length; i++) {
            for (let j = i + 1; j < sampledStats.length; j++) {
                const corr = this._pearsonCorr(
                    sampledStats[i].data, sampledStats[j].data
                );
                if (corr > 0.995) {
                    const name1 = sampledStats[i].name;
                    const name2 = sampledStats[j].name;
                    if (!this.badChannels.has(name1) && !result.has(name1)) {
                        result.set(name1, {
                            reason: 'auto', type: 'bridge',
                            note: `与${name2}桥接(r=${corr.toFixed(3)})`
                        });
                    }
                    if (!this.badChannels.has(name2) && !result.has(name2)) {
                        result.set(name2, {
                            reason: 'auto', type: 'bridge',
                            note: `与${name1}桥接(r=${corr.toFixed(3)})`
                        });
                    }
                }
            }
        }
        return result;
    }

    // 皮尔逊相关系数
    _pearsonCorr(x, y) {
        const n = Math.min(x.length, y.length);
        if (n < 100) return 0;
        let sumX = 0, sumY = 0;
        for (let i = 0; i < n; i++) { sumX += x[i]; sumY += y[i]; }
        const meanX = sumX / n, meanY = sumY / n;
        let cov = 0, varX = 0, varY = 0;
        for (let i = 0; i < n; i++) {
            const dx = x[i] - meanX;
            const dy = y[i] - meanY;
            cov += dx * dy;
            varX += dx * dx;
            varY += dy * dy;
        }
        const denom = Math.sqrt(varX * varY);
        return denom > 0 ? cov / denom : 0;
    }

    async _openFile() {
        this._stopAutosave();

        if (window.electronAPI) {
            try {
                const files = await window.electronAPI.openFileDialog();
                if (files && Array.isArray(files)) {
                    for (const file of files) {
                        try {
                            const arrayBuffer = this._ensureArrayBuffer(file.data);
                            this._loadEDFFromArrayBuffer(arrayBuffer, file.name, file.size);
                            if (file.filePath) {
                                await window.electronAPI.addRecentFile(file.filePath, file.name, file.size);
                            }
                        } catch (err) {
                            this._setStatus('数据传输错误: ' + err.message, 'error');
                        }
                    }
                }
            } catch (err) {
                this._setStatus('打开文件失败: ' + err.message, 'error');
            }
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.edf,.bdf';
        input.multiple = true;
        input.onchange = (e) => {
            for (const file of e.target.files) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this._loadEDFFromArrayBuffer(ev.target.result, file.name, file.size);
                };
                reader.readAsArrayBuffer(file);
            }
        };
        input.click();
    }

    async _toggleRecentFilesMenu() {
        const menu = document.getElementById('recent-files-menu');
        if (menu.classList.contains('hidden')) {
            await this._updateRecentFilesMenu();
            menu.classList.remove('hidden');
        } else {
            menu.classList.add('hidden');
        }
    }

    _hideRecentFilesMenu() {
        const menu = document.getElementById('recent-files-menu');
        if (menu) {
            menu.classList.add('hidden');
        }
    }

    async _updateRecentFilesMenu() {
        const menu = document.getElementById('recent-files-menu');
        if (!window.electronAPI) {
            menu.innerHTML = '<div class="recent-file-empty">仅 Electron 版本支持</div>';
            return;
        }
        try {
            const files = await window.electronAPI.getRecentFiles();
            if (!files || files.length === 0) {
                menu.innerHTML = '<div class="recent-file-empty">无最近文件</div>';
                return;
            }
            menu.innerHTML = files.map(f => `
                <div class="recent-file-item" data-path="${this._escapeHtml(f.filePath)}">
                    <span class="recent-file-name">${this._escapeHtml(f.fileName)}</span>
                    <span class="recent-file-path">${this._escapeHtml(f.filePath)}</span>
                </div>
            `).join('');
            menu.querySelectorAll('.recent-file-item').forEach(item => {
                item.addEventListener('click', () => {
                    this._openRecentFile(item.dataset.path);
                });
            });
        } catch (err) {
            menu.innerHTML = '<div class="recent-file-empty">加载失败</div>';
        }
    }

    async _openRecentFile(filePath) {
        this._hideRecentFilesMenu();
        if (!window.electronAPI) return;
        try {
            const result = await window.electronAPI.openRecentFile(filePath);
            if (result.success && result.data) {
                const arrayBuffer = this._ensureArrayBuffer(result.data.data);
                this._loadEDFFromArrayBuffer(arrayBuffer, result.data.name, result.data.size);
                await window.electronAPI.addRecentFile(result.data.filePath, result.data.name, result.data.size);
            } else {
                this._setStatus('打开文件失败: ' + (result.error || '未知错误'), 'error');
            }
        } catch (err) {
            this._setStatus('打开最近文件失败: ' + err.message, 'error');
        }
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _loadEDFFromArrayBuffer(arrayBuffer, fileName, fileSize) {
        const t0 = performance.now();
        this._setStatus('正在解析EDF...', 'loading');

        try {
            this.edfData = EDFParser.parse(arrayBuffer);
            if (!this.edfData) {
                this._setStatus('无效的EDF文件', 'error');
                return;
            }
        } catch (err) {
            this._setStatus('解析错误: ' + err.message, 'error');
            return;
        }

        const parseTime = (performance.now() - t0).toFixed(1);

        this.channels = this.edfData.channels;
        this.originalChannels = this.channels.map(ch => ({
            ...ch,
            data: new Float32Array(ch.data)
        }));
        this.sfreq = this.channels.length > 0 ? this.channels[0].sfreq : 0;
        this.duration = this.edfData.header.totalDuration;
        this.currentFile = fileName;
        this.recordingStart = this._parseEDFDateTime(
            this.edfData.header.startDate,
            this.edfData.header.startTime
        );
        this.annotations = [];
        this.bipolarChannels = null;
        this.showBipolar = false;

        document.getElementById('notch-select').value = 'off';
        document.getElementById('highpass-select').value = 'off';
        document.getElementById('lowpass-select').value = 'off';

        // 清除预览色带
        this.renderer.clearPreviewAnnotation();

        this._evaluateChannelQuality();

        this._updateChannelList();
        this._selectDefaultChannels();
        this._updateAnnoChannelOptions();
        this._updateFileInfo(fileName, fileSize);
        this._updateAnnotationsList();

        this._setStatus(
            `已加载: ${fileName} | ${this.channels.length}通道` +
            (this.badChannels.size > 0
                ? ` (有效${this.channels.length - this.badChannels.size})`
                : '') +
            ` | ${this.sfreq.toFixed(0)}Hz | ${this.duration.toFixed(0)}s | ${parseTime}ms`,
            'success'
        );

        this._startAutosave();

        this._checkAutosave(fileName).then(ad => {
            if (!ad) return;
            this._showAutosaveModal(ad, fileName);
        });

        // 应用标注类型颜色
        this._applyLabelColors();
    }

    _showAutosaveModal(ad, fileName) {
        const modal = document.getElementById('autosave-modal');
        const info = document.getElementById('autosave-modal-info');
        const btnRestore = document.getElementById('autosave-btn-restore');
        const btnDiscard = document.getElementById('autosave-btn-discard');

        const savedAt = new Date(ad.savedAt);
        info.innerHTML =
            `<span class="info-label">文件</span>${this._escapeHtml(ad.edfFileName)}<br>` +
            `<span class="info-label">标注数</span>${ad.annotations.length} 条<br>` +
            `<span class="info-label">保存时间</span>${savedAt.toLocaleString()}`;

        modal.style.display = 'flex';

        const onRestore = () => {
            modal.style.display = 'none';
            btnRestore.removeEventListener('click', onRestore);
            btnDiscard.removeEventListener('click', onDiscard);
            this._applyAutosaveData(ad);
            this._setStatus(`已恢复 ${this.annotations.length} 条标注`, 'success');
        };

        const onDiscard = () => {
            modal.style.display = 'none';
            btnRestore.removeEventListener('click', onRestore);
            btnDiscard.removeEventListener('click', onDiscard);
            if (window.electronAPI) {
                window.electronAPI.clearAutosave(fileName);
            }
        };

        btnRestore.addEventListener('click', onRestore);
        btnDiscard.addEventListener('click', onDiscard);
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _updateAnnoChannelOptions() {
        const select = document.getElementById('anno-channel');
        select.innerHTML = '<option value="">点击波形选中</option>';

        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;

        const sorted = channels.slice().sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true })
        );

        for (const ch of sorted) {
            const opt = document.createElement('option');
            opt.value = ch.name;
            opt.textContent = ch.name;
            select.appendChild(opt);
        }
    }

    _updateChannelList() {
        const container = document.getElementById('channel-list');
        container.innerHTML = '';

        const searchTerm = (document.getElementById('channel-search').value || '').toLowerCase();
        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;

        const sorted = channels.slice().sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true })
        );

        for (const ch of sorted) {
            if (searchTerm && ch.name.toLowerCase().indexOf(searchTerm) === -1) continue;
            if (this.filterBadChannels && !this.badChannels.has(ch.name)) continue;

            const div = document.createElement('div');
            div.className = 'channel-item';
            const badInfo = this.badChannels.get(ch.name);
            if (badInfo) {
                div.classList.add('channel-invalid');
            }
            if (this.selectedChannels.includes(ch.name)) {
                div.classList.add('selected');
            }

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.selectedChannels.includes(ch.name);
            checkbox.addEventListener('change', () => {
                this._toggleChannel(ch.name, checkbox.checked);
            });

            const label = document.createElement('span');
            label.className = 'channel-name';
            label.textContent = ch.name;

            if (badInfo) {
                const typeDef = App.BAD_CHANNEL_TYPES.find(
                    t => t.id === badInfo.type
                );
                const typeName = typeDef ? typeDef.name : badInfo.type;
                const typeColor = typeDef ? typeDef.color : '#607d8b';
                const tag = document.createElement('span');
                tag.className = 'bad-channel-tag';
                tag.textContent = typeName;
                tag.style.backgroundColor = typeColor + '33';
                tag.style.color = typeColor;
                tag.style.borderLeft = `3px solid ${typeColor}`;
                label.title = `${ch.name} (${badInfo.reason === 'auto' ? '自动' : '手动'}: ${typeName}${badInfo.note ? ' - ' + badInfo.note : ''})`;
                div.appendChild(checkbox);
                div.appendChild(label);
                div.appendChild(tag);
            } else {
                label.title = ch.name;
                div.appendChild(checkbox);
                div.appendChild(label);
            }

            // 右键菜单：手动标记/取消坏道
            div.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this._showBadChannelMenu(e, ch.name);
            });

            container.appendChild(div);
        }

        document.getElementById('channel-count').textContent =
            `${this.selectedChannels.length}/${channels.length}`;
    }

    // 右键菜单：标记/取消坏道
    _showBadChannelMenu(e, channelName) {
        // 移除已有菜单
        const existing = document.getElementById('bad-channel-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'bad-channel-menu';
        menu.className = 'context-menu';

        const isBad = this.badChannels.has(channelName);

        if (isBad) {
            const removeItem = document.createElement('div');
            removeItem.className = 'context-menu-item';
            removeItem.textContent = '取消坏道标记';
            removeItem.addEventListener('click', () => {
                this.badChannels.delete(channelName);
                this._updateChannelList();
                this._updateChannelLabels();
                menu.remove();
                this._setStatus(`已取消坏道: ${channelName}`, 'info');
            });
            menu.appendChild(removeItem);
        } else {
            for (const type of App.BAD_CHANNEL_TYPES) {
                const item = document.createElement('div');
                item.className = 'context-menu-item';
                const dot = document.createElement('span');
                dot.className = 'bad-type-dot';
                dot.style.backgroundColor = type.color;
                item.appendChild(dot);
                item.appendChild(document.createTextNode(type.name));
                item.addEventListener('click', () => {
                    this.badChannels.set(channelName, {
                        reason: 'manual', type: type.id, note: ''
                    });
                    this._updateChannelList();
                    this._updateChannelLabels();
                    menu.remove();
                    this._setStatus(`已标记坏道: ${channelName} (${type.name})`, 'info');
                });
                menu.appendChild(item);
            }
        }

        document.body.appendChild(menu);
        // 定位菜单
        const x = Math.min(e.clientX, window.innerWidth - 160);
        const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        // 点击其他位置关闭
        const closeMenu = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    _selectDefaultChannels() {
        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;

        this.selectedChannels = channels
            .filter(ch => !this.badChannels.has(ch.name))
            .map(ch => ch.name);

        this._updateChannelList();
        this._renderWaveforms();
    }

    _toggleChannel(name, checked) {
        if (checked) {
            if (!this.selectedChannels.includes(name)) {
                this.selectedChannels.push(name);
            }
        } else {
            this.selectedChannels = this.selectedChannels.filter(n => n !== name);
        }
        this._updateChannelList();
        this._renderWaveforms();
    }

    _selectAllChannels() {
        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;
        this.selectedChannels = channels.map(ch => ch.name);
        this._updateChannelList();
        this._renderWaveforms();
    }

    _deselectAllChannels() {
        this.selectedChannels = [];
        this._updateChannelList();
        this._renderWaveforms();
    }

    _filterChannels() {
        this._updateChannelList();
    }

    _toggleBadChannelFilter() {
        this.filterBadChannels = !this.filterBadChannels;
        const btn = document.getElementById('btn-filter-bad');
        btn.classList.toggle('active', this.filterBadChannels);
        if (this.filterBadChannels) {
            // 选中所有坏道通道，方便查看波形
            for (const [name] of this.badChannels) {
                if (!this.selectedChannels.includes(name)) {
                    this.selectedChannels.push(name);
                }
            }
            this._renderWaveforms();
        }
        this._updateChannelList();
    }

    _toggleOverview() {
        const canvas = document.getElementById('overview-canvas');
        const btn = document.getElementById('btn-overview');
        const visible = canvas.classList.toggle('visible');
        btn.classList.toggle('active', visible);
        if (this.renderer) {
            this.renderer._resizeTimeAxis();
            if (visible) this._renderOverview();
        }
    }

    _onLassoStart(e) {
        if (e.button !== 0 && e.button !== 2) return;
        const channelList = document.getElementById('channel-list');
        const item = e.target.closest('.channel-item');
        if (item && item.classList.contains('select-all-row')) return;
        if (e.target.tagName === 'INPUT') return;

        e.preventDefault();
        const rect = channelList.getBoundingClientRect();
        const mode = e.button === 2 ? 'remove' : 'add';
        this._lasso = {
            startX: e.clientX,
            startY: e.clientY,
            rect,
            scrollTop: channelList.scrollTop,
            preselected: new Set(this.selectedChannels),
            mode,
            el: null
        };

        const el = document.createElement('div');
        el.className = 'lasso-box' + (mode === 'remove' ? ' lasso-remove' : '');
        el.style.left = (e.clientX - rect.left) + 'px';
        el.style.top = (e.clientY - rect.top + channelList.scrollTop) + 'px';
        el.style.width = '0';
        el.style.height = '0';
        channelList.appendChild(el);
        this._lasso.el = el;
    }

    _onLassoMove(e) {
        if (!this._lasso) return;
        const { startX, startY, rect, el, preselected, mode, scrollTop } = this._lasso;

        const x1 = Math.max(Math.min(startX, e.clientX), rect.left);
        const y1 = Math.max(Math.min(startY, e.clientY), rect.top);
        const x2 = Math.min(Math.max(startX, e.clientX), rect.right);
        const y2 = Math.min(Math.max(startY, e.clientY), rect.bottom);

        el.style.left = (x1 - rect.left) + 'px';
        el.style.top = (y1 - rect.top + scrollTop) + 'px';
        el.style.width = (x2 - x1) + 'px';
        el.style.height = (y2 - y1) + 'px';

        const lassoRect = { left: x1, top: y1, right: x2, bottom: y2 };

        const channelList = document.getElementById('channel-list');
        const items = channelList.querySelectorAll(
            '.channel-item:not(.select-all-row)'
        );

        const newSelected = new Set(preselected);
        for (const item of items) {
            const nameEl = item.querySelector('.channel-name');
            if (!nameEl) continue;
            const name = nameEl.textContent;
            const itemRect = item.getBoundingClientRect();
            const overlaps = !(
                itemRect.right < lassoRect.left ||
                itemRect.left > lassoRect.right ||
                itemRect.bottom < lassoRect.top ||
                itemRect.top > lassoRect.bottom
            );
            if (overlaps) {
                if (mode === 'add') {
                    newSelected.add(name);
                } else {
                    newSelected.delete(name);
                }
            }
        }

        this.selectedChannels = [...newSelected];
        this._updateChannelListQuiet();
    }

    _onLassoEnd(e) {
        if (!this._lasso) return;
        if (this._lasso.el) {
            this._lasso.el.remove();
        }
        this._lasso = null;
        this._updateChannelList();
        this._renderWaveforms();
    }

    _updateChannelListQuiet() {
        const channelList = document.getElementById('channel-list');
        const items = channelList.querySelectorAll(
            '.channel-item:not(.select-all-row)'
        );
        for (const item of items) {
            const nameEl = item.querySelector('.channel-name');
            if (!nameEl) continue;
            const name = nameEl.textContent;
            const cb = item.querySelector('input[type="checkbox"]');
            const isSelected = this.selectedChannels.includes(name);
            if (cb) cb.checked = isSelected;
            item.classList.toggle('selected', isSelected);
        }

        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;
        document.getElementById('channel-count').textContent =
            `${this.selectedChannels.length}/${channels.length}`;

        const selectAllCb = document.getElementById('select-all-channels');
        if (selectAllCb) {
            selectAllCb.checked = channels.length > 0 &&
                this.selectedChannels.length === channels.length;
        }
    }

    _toggleBipolar() {
        if (!this.edfData) return;

        if (!this.bipolarChannels) {
            this.bipolarChannels = EDFParser.computeBipolar(this.channels);
            if (this.bipolarChannels.length === 0) {
                this._setStatus('未找到连续通道对用于双极导联', 'warning');
                return;
            }
        }

        this.showBipolar = !this.showBipolar;
        this.selectedChannels = [];
        document.getElementById('btn-bipolar').classList.toggle('active', this.showBipolar);
        this._evaluateChannelQuality();
        this._selectDefaultChannels();
        this._updateAnnoChannelOptions();

        // 通知渲染器当前模式
        this.renderer.setBipolarMode(this.showBipolar);

        // 重新渲染标注（会根据模式自动过滤）
        this.renderer.setAnnotations(this.annotations);
        this.renderer.render();
    }

    _toggleFixedHeight() {
        if (!this.edfData) return;
        const btn = document.getElementById('btn-fixed-height');
        const newMode = !this.renderer.fixedHeightMode;
        this.renderer.setFixedHeightMode(newMode);
        btn.classList.toggle('active', newMode);
        this.renderer.render();
        this._updateChannelLabels();
        this._setStatus(
            newMode ? '已切换到固定高度模式（左键拖拽滚动）' : '已切换到自适应模式',
            'info'
        );
    }

    _renderWaveforms() {
        if (!this.edfData || this.selectedChannels.length === 0) {
            this.renderer.channels = [];
            this.renderer.render();
            this._updateChannelLabels();
            return;
        }

        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;

        const selected = this.selectedChannels
            .map(name => channels.find(ch => ch.name === name))
            .filter(ch => ch !== undefined);

        selected.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true })
        );

        // 设置渲染器模式
        this.renderer.setBipolarMode(this.showBipolar);
        this.renderer.setChannels(selected, this.sfreq, this.duration);
        this.renderer.setAnnotations(this.annotations);
        this._applySensitivity(this.sensitivityUv);
        this._updateTimeDisplay(this.renderer.viewportStart, this.renderer.viewportEnd);
        this._updateChannelLabels();
        this._renderOverview();
    }

    _applySensitivity(uvValue) {
        this.sensitivityUv = uvValue;

        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;

        const selected = this.selectedChannels
            .map(name => channels.find(ch => ch.name === name))
            .filter(ch => ch !== undefined);

        if (selected.length === 0) {
            this.renderer.setSensitivity(1.0);
            return;
        }

        const ranges = selected
            .map(ch => ch.physicalMax - ch.physicalMin)
            .filter(r => r > 0)
            .sort((a, b) => a - b);

        if (ranges.length === 0) {
            this.renderer.setSensitivity(1.0);
            return;
        }

        const medianRange = ranges[Math.floor(ranges.length / 2)];
        const multiplier = (medianRange / 2) / uvValue;
        this.renderer.setSensitivity(multiplier);
        this._updateChannelLabels();
    }

    _applyFilters() {
        if (!this.originalChannels) return;

        const notchFreq = document.getElementById('notch-select').value;
        const highpassFreq = parseFloat(document.getElementById('highpass-select').value);
        const lowpassFreq = parseFloat(document.getElementById('lowpass-select').value);

        for (let i = 0; i < this.channels.length; i++) {
            const origData = this.originalChannels[i].data;
            let data = new Float32Array(origData);

            if (notchFreq !== 'off') {
                const freq = parseInt(notchFreq);
                data = this._notchFilter(data, freq, this.sfreq);
            }
            if (!isNaN(highpassFreq)) {
                data = this._highpassFilter(data, highpassFreq, this.sfreq);
            }
            if (!isNaN(lowpassFreq)) {
                data = this._lowpassFilter(data, lowpassFreq, this.sfreq);
            }

            this.channels[i].data = data;
        }

        if (this.showBipolar && this.bipolarChannels) {
            this.bipolarChannels = EDFParser.computeBipolar(this.channels);
        }

        this._evaluateChannelQuality();
        this._renderWaveforms();
    }

    _notchFilter(data, freq, sfreq) {
        const Q = 30;
        const w0 = 2 * Math.PI * freq / sfreq;
        const alpha = Math.sin(w0) / (2 * Q);

        const b0 = 1;
        const b1 = -2 * Math.cos(w0);
        const b2 = 1;
        const a0 = 1 + alpha;
        const a1 = -2 * Math.cos(w0);
        const a2 = 1 - alpha;

        const out = new Float32Array(data.length);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

        for (let i = 0; i < data.length; i++) {
            const x0 = data[i];
            const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
            out[i] = y0;
            x2 = x1; x1 = x0;
            y2 = y1; y1 = y0;
        }
        return out;
    }

    _highpassFilter(data, cutoff, sfreq) {
        const RC = 1 / (2 * Math.PI * cutoff);
        const dt = 1 / sfreq;
        const alpha = RC / (RC + dt);

        const out = new Float32Array(data.length);
        out[0] = data[0];
        for (let i = 1; i < data.length; i++) {
            out[i] = alpha * (out[i - 1] + data[i] - data[i - 1]);
        }
        return out;
    }

    _lowpassFilter(data, cutoff, sfreq) {
        const RC = 1 / (2 * Math.PI * cutoff);
        const dt = 1 / sfreq;
        const alpha = dt / (RC + dt);

        const out = new Float32Array(data.length);
        out[0] = data[0] * alpha;
        for (let i = 1; i < data.length; i++) {
            out[i] = out[i - 1] + alpha * (data[i] - out[i - 1]);
        }
        return out;
    }

    _updateLabelPositions() {
        if (!this.renderer.fixedHeightMode) return;
        const container = document.getElementById('channel-labels');
        const innerDiv = container.querySelector('div');
        if (innerDiv) {
            innerDiv.style.transform =
                `translateY(${-this.renderer.channelScrollY}px)`;
        }
    }

    _updateChannelLabels() {
        const container = document.getElementById('channel-labels');
        container.innerHTML = '';

        const channels = this.renderer.channels;
        if (channels.length === 0) return;

        const containerHeight = container.clientHeight;
        const channelCount = channels.length;

        if (this.renderer.fixedHeightMode) {
            const chHeight = this.renderer.fixedChannelHeight;
            const scrollY = this.renderer.channelScrollY;

            container.style.overflow = 'hidden';
            container.style.paddingTop = '0';
            container.style.paddingBottom = '0';

            const fontSize = Math.max(8, Math.min(14, Math.floor(chHeight * 0.3)));

            // 通道标签容器宽度固定，不随通道名称长度变化
            // 超长名称通过CSS text-overflow: ellipsis截断，title悬浮提示完整名称

            const innerDiv = document.createElement('div');
            innerDiv.style.transform = `translateY(${-scrollY}px)`;

            // 计算幅度参考线的位置
            // sensitivity=1 时波形占通道高度的 0.45
            // 限制参考线偏移不超过通道高度的 45%，确保在可见范围内
            const maxOffset = chHeight * 0.45;
            const refOffset = Math.min(maxOffset, chHeight * 0.45 * this.renderer.sensitivity);
            const refLineTop = chHeight * 0.5 - refOffset;  // 正峰值参考线位置
            const refLineBottom = chHeight * 0.5 + refOffset; // 负峰值参考线位置

            for (let i = 0; i < channelCount; i++) {
                const ch = channels[i];
                const div = document.createElement('div');
                div.className = 'channel-label-item';
                if (ch.name === this.selectedAnnoChannel) {
                    div.classList.add('selected');
                }
                div.style.height = chHeight + 'px';
                div.style.fontSize = fontSize + 'px';
                div.style.lineHeight = chHeight + 'px';
                div.style.position = 'relative';

                // 添加幅度标尺
                const scalebar = document.createElement('div');
                scalebar.className = 'scalebar';

                // 中心线
                const centerLine = document.createElement('div');
                centerLine.className = 'scalebar-line center';
                centerLine.style.top = (chHeight / 2) + 'px';
                scalebar.appendChild(centerLine);

                // 正峰值参考线
                const posLine = document.createElement('div');
                posLine.className = 'scalebar-line';
                posLine.style.top = refLineTop + 'px';
                scalebar.appendChild(posLine);

                // 负峰值参考线
                const negLine = document.createElement('div');
                negLine.className = 'scalebar-line';
                negLine.style.top = refLineBottom + 'px';
                scalebar.appendChild(negLine);

                // 电压标签
                const label = document.createElement('span');
                label.className = 'scalebar-label';
                label.style.top = refLineTop + 'px';
                label.textContent = '+' + this.sensitivityUv + 'μV';
                scalebar.appendChild(label);

                const labelNeg = document.createElement('span');
                labelNeg.className = 'scalebar-label';
                labelNeg.style.top = refLineBottom + 'px';
                labelNeg.textContent = '-' + this.sensitivityUv + 'μV';
                scalebar.appendChild(labelNeg);

                div.appendChild(scalebar);

                const span = document.createElement('span');
                span.textContent = ch.name;
                const badInfo = this.badChannels.get(ch.name);
                if (badInfo) {
                    const typeDef = App.BAD_CHANNEL_TYPES.find(
                        t => t.id === badInfo.type
                    );
                    const typeName = typeDef ? typeDef.name : badInfo.type;
                    span.title = `${ch.name} [坏道: ${typeName}${badInfo.note ? ' - ' + badInfo.note : ''}]`;
                    div.classList.add('bad-channel');
                } else {
                    span.title = ch.name;
                }

                div.appendChild(span);
                div.addEventListener('click', () => {
                    this._selectAnnoChannel(ch.name);
                    this._setStatus(`已选中通道: ${ch.name}`, 'info');
                    this._updateStepUI();
                });
                innerDiv.appendChild(div);
            }

            container.appendChild(innerDiv);
        } else {
            const rawH = 1.0 / channelCount;
            const ampVal = rawH * 0.45 * this.renderer.sensitivity;
            const padClamped = Math.min(ampVal, 0.02);
            const padPx = Math.round(padClamped * containerHeight);
            const usablePx = containerHeight - 2 * padPx;
            const channelHeight = usablePx / channelCount;

            container.style.overflow = 'hidden';
            container.style.position = '';
            container.style.display = '';
            container.style.paddingTop = '0';
            container.style.paddingBottom = '0';

            const minFontSize = 6;
            const maxFontSize = 14;
            const adaptiveFontSize = Math.max(
                minFontSize,
                Math.min(maxFontSize, Math.floor(channelHeight * 0.65))
            );

            // 通道标签容器宽度固定，不随通道名称长度变化
            // 超长名称通过CSS text-overflow: ellipsis截断，title悬浮提示完整名称

            const topSpacer = document.createElement('div');
            topSpacer.style.height = padPx + 'px';
            topSpacer.style.flexShrink = '0';
            container.appendChild(topSpacer);

            // 计算幅度参考线的位置
            // sensitivity=1 时波形占通道高度的 0.45
            // 限制参考线偏移不超过通道高度的 45%，确保在可见范围内
            const maxOffset = channelHeight * 0.45;
            const refOffset = Math.min(maxOffset, channelHeight * 0.45 * this.renderer.sensitivity);

            for (let i = 0; i < channelCount; i++) {
                const ch = channels[i];
                const div = document.createElement('div');
                div.className = 'channel-label-item';
                if (ch.name === this.selectedAnnoChannel) {
                    div.classList.add('selected');
                }
                div.style.height = channelHeight + 'px';
                div.style.fontSize = adaptiveFontSize + 'px';
                div.style.lineHeight = channelHeight + 'px';
                div.style.position = 'relative';

                // 添加幅度标尺
                const scalebar = document.createElement('div');
                scalebar.className = 'scalebar';

                // 中心线
                const centerLine = document.createElement('div');
                centerLine.className = 'scalebar-line center';
                centerLine.style.top = (channelHeight / 2) + 'px';
                scalebar.appendChild(centerLine);

                // 正峰值参考线
                const posLine = document.createElement('div');
                posLine.className = 'scalebar-line';
                posLine.style.top = (channelHeight / 2 - refOffset) + 'px';
                scalebar.appendChild(posLine);

                // 负峰值参考线
                const negLine = document.createElement('div');
                negLine.className = 'scalebar-line';
                negLine.style.top = (channelHeight / 2 + refOffset) + 'px';
                scalebar.appendChild(negLine);

                // 电压标签（只在空间足够时显示）
                if (channelHeight > 20) {
                    const label = document.createElement('span');
                    label.className = 'scalebar-label';
                    label.style.top = (channelHeight / 2 - refOffset) + 'px';
                    label.textContent = '+' + this.sensitivityUv + 'μV';
                    scalebar.appendChild(label);

                    const labelNeg = document.createElement('span');
                    labelNeg.className = 'scalebar-label';
                    labelNeg.style.top = (channelHeight / 2 + refOffset) + 'px';
                    labelNeg.textContent = '-' + this.sensitivityUv + 'μV';
                    scalebar.appendChild(labelNeg);
                }

                div.appendChild(scalebar);

                const span = document.createElement('span');
                span.textContent = ch.name;
                const badInfo = this.badChannels.get(ch.name);
                if (badInfo) {
                    const typeDef = App.BAD_CHANNEL_TYPES.find(
                        t => t.id === badInfo.type
                    );
                    const typeName = typeDef ? typeDef.name : badInfo.type;
                    span.title = `${ch.name} [坏道: ${typeName}${badInfo.note ? ' - ' + badInfo.note : ''}]`;
                    div.classList.add('bad-channel');
                } else {
                    span.title = ch.name;
                }

                div.appendChild(span);
                div.addEventListener('click', () => {
                    this._selectAnnoChannel(ch.name);
                    this._setStatus(`已选中通道: ${ch.name}`, 'info');
                    this._updateStepUI();
                });
                container.appendChild(div);
            }

            const bottomSpacer = document.createElement('div');
            bottomSpacer.style.height = padPx + 'px';
            bottomSpacer.style.flexShrink = '0';
            container.appendChild(bottomSpacer);
        }
    }

    _updateTimeDisplay(start, end) {
        document.getElementById('current-time').textContent = this._formatTime(start);
        document.getElementById('total-time').textContent = this._formatTime(this.duration);
        document.getElementById('time-range').textContent =
            `${this._formatTimeFull(start)} - ${this._formatTimeFull(end)}`;
    }

    _updateFileInfo(name, size) {
        const sizeStr = size > 1024 * 1024
            ? (size / (1024 * 1024)).toFixed(1) + ' MB'
            : (size / 1024).toFixed(1) + ' KB';
        document.getElementById('file-info').textContent =
            `${name} | ${this.channels.length}通道 | ${this.sfreq.toFixed(0)}Hz | ${this.duration.toFixed(0)}s | ${sizeStr}`;
    }

    _toggleAnnotationMode() {
        this.annotationMode = !this.annotationMode;
        this.annoStart = null;
        this.annoStartTime = null;
        this.annoEndTime = null;
        document.getElementById('anno-start').value = '';
        document.getElementById('anno-end').value = '';
        this._updateAnnoModeButton();
        this._updateStepUI();
    }

    _updateAnnoModeButton() {
        const btn = document.getElementById('btn-anno-mode');
        btn.classList.toggle('active', this.annotationMode);
        btn.textContent = this.annotationMode ? '标注中' : '开始标注';
        document.getElementById('waveform-canvas').style.cursor =
            this.annotationMode ? 'crosshair' : 'default';
    }

    _updateStepUI() {
        const channelVal = document.getElementById('anno-channel').value;

        const stepChannel = document.getElementById('step-channel');
        const stepTime = document.getElementById('step-time');
        const stepLabel = document.getElementById('step-label');

        const channelHint = document.getElementById('channel-hint');
        const timeHint = document.getElementById('time-hint');

        stepChannel.classList.remove('active', 'completed');
        stepTime.classList.remove('active', 'completed');
        stepLabel.classList.remove('active', 'completed');

        const hasChannel = channelVal !== '';
        const hasTime = this.annoStartTime !== null && this.annoEndTime !== null;

        if (!hasChannel) {
            stepChannel.classList.add('active');
            if (channelHint) {
                channelHint.textContent = '点击波形上的通道自动选中';
            }
        } else {
            stepChannel.classList.add('completed');
            if (channelHint) {
                channelHint.textContent = `已选: ${channelVal}`;
            }
        }

        if (hasChannel && !hasTime) {
            stepTime.classList.add('active');
            if (timeHint) {
                if (this.annotationMode) {
                    timeHint.textContent = '中键点击波形设置起止时间，右键取消';
                } else {
                    timeHint.textContent = '中键点击波形开始标注';
                }
            }
        } else if (hasTime) {
            stepTime.classList.add('completed');
            if (timeHint) {
                timeHint.textContent =
                    `${this._formatTime(this.annoStartTime)} - ${this._formatTime(this.annoEndTime)}`;
            }
        } else {
            if (timeHint) {
                timeHint.textContent = '请先选择通道';
            }
        }

        if (hasChannel && hasTime) {
            stepLabel.classList.add('active');
        }
    }

    _handleCanvasClick(e) {
        if (!this.edfData) return;

        const channelName = this.renderer.getChannelAtMouse(e.clientY);

        if (channelName) {
            this._selectAnnoChannel(channelName);
            this.renderer.setSelectedChannel(channelName);
            this.renderer.render();
            this._updateChannelLabels();
            this._setStatus(`已选中通道: ${channelName}`, 'info');
        }

        this._updateStepUI();
    }

    _handleCanvasMiddleClick(e) {
        if (!this.edfData) return;

        const time = this.renderer.getTimeAtMouse(e.clientX);
        const channelName = this.renderer.getChannelAtMouse(e.clientY);

        if (!this.annotationMode) {
            if (!this.annoPanelVisible) {
                this._showAnnoPanel();
            }
            this.annotationMode = true;
            this._updateAnnoModeButton();
            if (channelName) {
                this._selectAnnoChannel(channelName);
            }
            this._setStatus(
                '标注模式已开启 — 中键点击设置起点，右键取消',
                'info'
            );
            this._updateStepUI();
            return;
        }

        if (channelName) {
            this._selectAnnoChannel(channelName);
        }

        if (this.annoStart === null) {
            // 设置起点
            this.annoStart = time;
            this.annoStartTime = time;
            this.annoEndTime = null;
            document.getElementById('anno-start').value = this._formatTime(time);
            document.getElementById('anno-end').value = '';

            // 开始预览：监听鼠标移动
            this._setupPreviewListeners();

            this._setStatus(
                `起点: ${this._formatTime(time)}` +
                (channelName ? ` | 通道: ${channelName}` : '') +
                ' — 移动鼠标预览，再次中键点击设置终点',
                'info'
            );
        } else {
            // 设置终点
            const start = Math.min(this.annoStart, time);
            const end = Math.max(this.annoStart, time);
            this.annoStartTime = start;
            this.annoEndTime = end;
            this.annoStart = null;
            this.annotationMode = false;

            // 移除鼠标移动监听器，但保留预览色带在最终位置
            const canvas = this.renderer.canvas;
            if (this._previewMouseMoveHandler) {
                canvas.removeEventListener('mousemove', this._previewMouseMoveHandler);
                this._previewMouseMoveHandler = null;
            }
            if (this._previewMouseLeaveHandler) {
                canvas.removeEventListener('mouseleave', this._previewMouseLeaveHandler);
                this._previewMouseLeaveHandler = null;
            }
            if (this._previewMouseEnterHandler) {
                canvas.removeEventListener('mouseenter', this._previewMouseEnterHandler);
                this._previewMouseEnterHandler = null;
            }

            this._updateAnnoModeButton();
            document.getElementById('anno-start').value = this._formatTime(start);
            document.getElementById('anno-end').value = this._formatTime(end);
            this._setStatus(
                `时间: ${this._formatTime(start)} - ${this._formatTime(end)}` +
                (channelName ? ` | 通道: ${channelName}` : '') +
                ' — 选择标签后点击添加',
                'info'
            );
        }

        this._updateStepUI();
    }

    // 设置预览色带的鼠标监听器
    _setupPreviewListeners() {
        const canvas = this.renderer.canvas;

        // 鼠标移动时更新预览色带
        this._previewMouseMoveHandler = (e) => {
            if (this.annoStart === null) return;
            const time = this.renderer.getTimeAtMouse(e.clientX);
            const channel = document.getElementById('anno-channel').value;
            const label = document.getElementById('anno-label').value || 'other';

            // 计算 originalChannel
            let originalChannel = '';
            if (channel) {
                if (this.showBipolar && this.bipolarChannels) {
                    const bp = this.bipolarChannels.find(c => c.name === channel);
                    if (bp && bp.ch1 && bp.ch2) {
                        // 使用 & 连接原始通道名
                        originalChannel = `${bp.ch1}&${bp.ch2}`;
                    }
                } else {
                    originalChannel = channel;
                }
            }

            this.renderer.setPreviewAnnotation(this.annoStart, time, originalChannel, label);
        };

        // 鼠标离开画布时清除预览
        this._previewMouseLeaveHandler = () => {
            this.renderer.clearPreviewAnnotation();
        };

        // 鼠标进入画布时恢复预览
        this._previewMouseEnterHandler = (e) => {
            if (this.annoStart !== null) {
                const time = this.renderer.getTimeAtMouse(e.clientX);
                const channel = document.getElementById('anno-channel').value;
                const label = document.getElementById('anno-label').value || 'other';

                // 计算 originalChannel
                let originalChannel = '';
                if (channel) {
                    if (this.showBipolar && this.bipolarChannels) {
                        const bp = this.bipolarChannels.find(c => c.name === channel);
                        if (bp && bp.ch1 && bp.ch2) {
                            originalChannel = `${bp.ch1}&${bp.ch2}`;
                        }
                    } else {
                        originalChannel = channel;
                    }
                }

                this.renderer.setPreviewAnnotation(this.annoStart, time, originalChannel, label);
            }
        };

        canvas.addEventListener('mousemove', this._previewMouseMoveHandler);
        canvas.addEventListener('mouseleave', this._previewMouseLeaveHandler);
        canvas.addEventListener('mouseenter', this._previewMouseEnterHandler);
    }

    // 清除预览色带的鼠标监听器
    _cleanupPreviewListeners() {
        const canvas = this.renderer.canvas;

        if (this._previewMouseMoveHandler) {
            canvas.removeEventListener('mousemove', this._previewMouseMoveHandler);
            this._previewMouseMoveHandler = null;
        }
        if (this._previewMouseLeaveHandler) {
            canvas.removeEventListener('mouseleave', this._previewMouseLeaveHandler);
            this._previewMouseLeaveHandler = null;
        }
        if (this._previewMouseEnterHandler) {
            canvas.removeEventListener('mouseenter', this._previewMouseEnterHandler);
            this._previewMouseEnterHandler = null;
        }

        // 清除预览色带
        this.renderer.clearPreviewAnnotation();
    }

    _handleCanvasRightClick(e) {
        if (!this.edfData) return;

        if (this.annotationMode && this.annoStart !== null) {
            this.annoStart = null;
            this.annoStartTime = null;
            this.annoEndTime = null;
            document.getElementById('anno-start').value = '';
            document.getElementById('anno-end').value = '';
            // 清除预览
            this._cleanupPreviewListeners();
            this._setStatus('已取消标注选择', 'info');
            this._updateStepUI();
        } else if (this.annotationMode) {
            this.annotationMode = false;
            this._updateAnnoModeButton();
            this._setStatus('已退出标注模式', 'info');
        } else {
            this.renderer.setSelectedChannel(null);
            this.renderer.render();
            this._setStatus('已取消通道选中', 'info');
        }
    }

    _selectAnnoChannel(channelName) {
        this.selectedAnnoChannel = channelName;
        const select = document.getElementById('anno-channel');
        const options = select.options;
        for (let i = 0; i < options.length; i++) {
            if (options[i].value === channelName) {
                select.selectedIndex = i;
                break;
            }
        }
        this.renderer.setSelectedChannel(channelName);
        this.renderer.render();
        this._updateChannelLabels();
    }

    // ── Undo / Redo ──────────────────────────────────────────────────────────

    _saveToHistory() {
        // 深拷贝当前标注数组存入 undoStack
        this.undoStack.push(this.annotations.map(a => ({ ...a })));
        if (this.undoStack.length > 50) this.undoStack.shift();
        // 任何新操作都清空 redoStack
        this.redoStack = [];
    }

    _undo() {
        if (this.undoStack.length === 0) {
            this._setStatus('没有可撤销的操作', 'info');
            return;
        }
        // 当前状态压入 redoStack
        this.redoStack.push(this.annotations.map(a => ({ ...a })));
        // 恢复上一步
        this.annotations = this.undoStack.pop();
        this._updateAnnotationsList();
        this.renderer.setAnnotations(this.annotations);
        this.renderer.render();
        this._setStatus(`已撤销 — 当前标注 ${this.annotations.length} 条`, 'info');
        this._doAutosave();
    }

    _redo() {
        if (this.redoStack.length === 0) {
            this._setStatus('没有可重做的操作', 'info');
            return;
        }
        // 当前状态压入 undoStack
        this.undoStack.push(this.annotations.map(a => ({ ...a })));
        // 恢复下一步
        this.annotations = this.redoStack.pop();
        this._updateAnnotationsList();
        this.renderer.setAnnotations(this.annotations);
        this.renderer.render();
        this._setStatus(`已重做 — 当前标注 ${this.annotations.length} 条`, 'info');
        this._doAutosave();
    }

    // ─────────────────────────────────────────────────────────────────────────

    _addAnnotation() {
        const labelInput = document.getElementById('anno-label');
        const channelInput = document.getElementById('anno-channel');

        const start = this.annoStartTime;
        const end = this.annoEndTime;
        const label = labelInput.value || '发作';
        const selectedChannel = channelInput.value || '';

        if (start === null || end === null || start >= end) {
            this._setStatus('无效的时间范围', 'error');
            return;
        }

        this._saveToHistory();

        // 保存原始通道格式（统一用 & 连接双极通道）
        let originalChannel = '';

        if (selectedChannel) {
            if (this.showBipolar && this.bipolarChannels) {
                // 双极模式：查找 bipolar 通道
                const bp = this.bipolarChannels.find(c => c.name === selectedChannel);
                if (bp && bp.ch1 && bp.ch2) {
                    // 原始通道1&原始通道2
                    originalChannel = `${bp.ch1}&${bp.ch2}`;
                }
            } else {
                // 单极模式：直接使用原始通道名
                originalChannel = selectedChannel;
            }
        }

        const note = document.getElementById('anno-note').value.trim();

        this.annotations.push({
            start, end, label,
            originalChannel,
            note,
        });
        this._updateAnnotationsList();
        this.renderer.setAnnotations(this.annotations);
        this.renderer.clearPreviewAnnotation(); // 清除预览色带
        this.renderer.render();
        this._setStatus(
            `已添加标注: ${this._formatTime(start)} - ${this._formatTime(end)} [${label}]` +
            (originalChannel ? ` 通道: ${originalChannel}` : ''),
            'success'
        );

        this.annoStartTime = null;
        this.annoEndTime = null;
        document.getElementById('anno-start').value = '';
        document.getElementById('anno-end').value = '';
        document.getElementById('anno-note').value = '';
        this.selectedAnnoChannel = null;
        this.renderer.setSelectedChannel(null);
        this.renderer.render();
        this._updateChannelLabels();
        this._updateStepUI();
        // 如果 autosave 已停止，导出后再标注则重新启动
        if (!this._autosaveTimer) {
            this._startAutosave();
        }
        this._doAutosave();
    }

    _deleteAnnotation(index) {
        this._saveToHistory();
        this.annotations.splice(index, 1);
        this._updateAnnotationsList();
        this.renderer.setAnnotations(this.annotations);
        this.renderer.render();
        this._doAutosave();
    }

    _clearAnnotations() {
        if (this.annotations.length === 0) return;
        this._saveToHistory();
        this.annotations = [];
        this._updateAnnotationsList();
        this.renderer.setAnnotations(this.annotations);
        this.renderer.render();
        this._doAutosave();
    }

    _updateAnnotationsList() {
        const container = document.getElementById('annotations-list');
        container.innerHTML = '';

        this.annotations.sort((a, b) => a.start - b.start);

        for (let i = 0; i < this.annotations.length; i++) {
            const ann = this.annotations[i];
            const row = document.createElement('div');
            row.className = 'annotation-row';

            const timeSpan = document.createElement('span');
            timeSpan.className = 'anno-time';
            timeSpan.textContent =
                `${this._formatTime(ann.start)} - ${this._formatTime(ann.end)}`;

            if (ann.originalChannel) {
                const chSpan = document.createElement('span');
                chSpan.className = 'anno-channel';
                chSpan.textContent = ann.originalChannel;
                chSpan.title = ann.originalChannel; // 鼠标悬停显示完整名称
                row.appendChild(timeSpan);
                row.appendChild(chSpan);
            } else {
                row.appendChild(timeSpan);
            }

            // 查找标签类型名称和颜色
            const labelType = this._labelTypes.find(t => t.id === ann.label);
            const labelName = labelType ? labelType.name : ann.label;
            const labelColor = labelType ? labelType.color : [0.6, 0.6, 0.6];

            const labelSpan = document.createElement('span');
            labelSpan.className = 'anno-label';
            labelSpan.textContent = labelName;
            // 设置标签颜色（内联样式优先级高于 class）
            labelSpan.style.backgroundColor =
                `rgba(${labelColor[0]*255},${labelColor[1]*255},${labelColor[2]*255},0.25)`;
            labelSpan.style.borderLeft = `3px solid rgb(${labelColor[0]*255},${labelColor[1]*255},${labelColor[2]*255})`;
            labelSpan.style.color = `rgb(${labelColor[0]*255},${labelColor[1]*255},${labelColor[2]*255})`;

            if (ann.note) {
                const noteSpan = document.createElement('span');
                noteSpan.className = 'anno-note';
                noteSpan.textContent = ann.note;
                noteSpan.title = ann.note;
                row.appendChild(noteSpan);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'anno-delete';
            delBtn.textContent = '×';
            delBtn.addEventListener('click', () => this._deleteAnnotation(i));

            row.appendChild(labelSpan);
            row.appendChild(delBtn);
            container.appendChild(row);
        }

        document.getElementById('anno-count').textContent =
            `标注: ${this.annotations.length}`;
    }

    async _exportAnnotations() {
        if (this.annotations.length === 0) {
            this._setStatus('没有标注可导出', 'warning');
            return;
        }

        const lines = [
            '# EEG Annotation Data',
            `# File: ${this.currentFile || 'unknown'}`,
            `# Exported: ${new Date().toISOString()}`,
            '#',
            'Channel\tStart\tEnd\tLabel\tNote',
            '',
        ];

        for (const ann of this.annotations) {
            const ch = ann.originalChannel || 'ALL';
            const note = ann.note || '';
            lines.push(
                `${ch}\t` +
                `${this._formatTime(ann.start)}\t` +
                `${this._formatTime(ann.end)}\t` +
                `${ann.label}\t` +
                `${note}`
            );
        }

        const content = lines.join('\n');

        if (window.electronAPI) {
            const result = await window.electronAPI.exportAnnotations({
                fileName: this.currentFile,
                content: content,
            });
            if (result) {
                this._setStatus(`已导出 ${this.annotations.length} 条标注`, 'success');
                await window.electronAPI.clearAutosave(this.currentFile);
                this._stopAutosave();
            }
            return;
        }

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (this.currentFile ? this.currentFile.replace(/\.edf$/i, '') : 'annotations') + '_labels.txt';
        a.click();
        URL.revokeObjectURL(url);
        this._setStatus(`已导出 ${this.annotations.length} 条标注`, 'success');
    }

    async _importAnnotationsDialog() {
        if (window.electronAPI) {
            const content = await window.electronAPI.importAnnotations();
            if (content) {
                this._importAnnotations(content);
            }
            return;
        }
    }

    // ── 坏道导入/导出 ──────────────────────────────────────────────────────

    async _exportBadChannels() {
        if (this.badChannels.size === 0) {
            this._setStatus('没有坏道标记可导出', 'warning');
            return;
        }

        const lines = [
            '# EEG Bad Channel Data',
            `# File: ${this.currentFile || 'unknown'}`,
            `# Exported: ${new Date().toISOString()}`,
            '#',
            'Channel\tType\tReason\tNote',
            '',
        ];

        for (const [name, info] of this.badChannels) {
            const type = info.type || 'other';
            const reason = info.reason || 'manual';
            const note = info.note || '';
            lines.push(`${name}\t${type}\t${reason}\t${note}`);
        }

        const content = lines.join('\n');

        if (window.electronAPI) {
            const result = await window.electronAPI.exportBadChannels({
                fileName: this.currentFile,
                content: content,
            });
            if (result) {
                this._setStatus(`已导出 ${this.badChannels.size} 个坏道标记`, 'success');
            }
            return;
        }

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (this.currentFile
            ? this.currentFile.replace(/\.edf$/i, '') : 'badchannels') + '_bad.txt';
        a.click();
        URL.revokeObjectURL(url);
        this._setStatus(`已导出 ${this.badChannels.size} 个坏道标记`, 'success');
    }

    async _importBadChannelsDialog() {
        if (window.electronAPI) {
            const content = await window.electronAPI.importBadChannels();
            if (content) {
                this._importBadChannels(content);
            }
            return;
        }
    }

    _importBadChannels(content) {
        const lines = content.split('\n');
        let count = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const parts = trimmed.split('\t');
            if (parts.length >= 2) {
                const channel = parts[0];
                const type = parts[1] || 'other';
                const reason = parts[2] || 'manual';
                const note = parts[3] || '';

                // 手动标记优先，不覆盖已有的手动标记
                const existing = this.badChannels.get(channel);
                if (existing && existing.reason === 'manual' && reason === 'auto') {
                    continue;
                }

                this.badChannels.set(channel, { reason, type, note });
                count++;
            }
        }

        this._updateChannelList();
        this._updateChannelLabels();
        this._setStatus(`已导入 ${count} 个坏道标记`, 'success');
    }

    _parseAbsoluteTime(timeStr) {
        const match = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$/);
        if (!match) return NaN;
        const h = parseInt(match[1]);
        const m = parseInt(match[2]);
        const s = parseInt(match[3]);
        const ms = parseInt(match[4].padEnd(3, '0'));
        const absSeconds = h * 3600 + m * 60 + s + ms / 1000;
        if (this.recordingStart) {
            const startH = this.recordingStart.getHours();
            const startM = this.recordingStart.getMinutes();
            const startS = this.recordingStart.getSeconds();
            const startMs = this.recordingStart.getMilliseconds();
            const startOffset = startH * 3600 + startM * 60 +
                startS + startMs / 1000;
            return absSeconds - startOffset;
        }
        return absSeconds;
    }

    _importAnnotations(content) {
        this._saveToHistory();
        const lines = content.split('\n');
        let count = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const parts = trimmed.split('\t');
            if (parts.length >= 4) {
                const channelStr = parts[0] === 'ALL' ? '' : parts[0];
                const startStr = parts[1];
                const endStr = parts[2];
                const label = parts[3] || 'other';
                const note = parts[4] || '';

                let start = this._parseAbsoluteTime(startStr);
                let end = this._parseAbsoluteTime(endStr);

                if (isNaN(start)) start = parseFloat(startStr);
                if (isNaN(end)) end = parseFloat(endStr);

                if (!isNaN(start) && !isNaN(end) && end > start) {
                    this.annotations.push({
                        start, end, label,
                        originalChannel: channelStr,
                        note,
                    });
                    count++;
                }
            } else if (parts.length >= 3) {
                const start = parseFloat(parts[0]);
                const end = parseFloat(parts[1]);
                const label = parts[2] || 'other';
                const channel = parts.length >= 4 && isNaN(parseFloat(parts[2])) ? parts[2] : '';
                const note = parts.length >= 5 ? parts[4] : '';

                if (!isNaN(start) && !isNaN(end) && end > start) {
                    this.annotations.push({ start, end, label, originalChannel: channel, note });
                    count++;
                }
            }
        }

        this._updateAnnotationsList();
        this.renderer.setAnnotations(this.annotations);
        this.renderer.render();
        this._setStatus(`已导入 ${count} 条标注`, 'success');
        this._doAutosave();
    }

    _fitToWindow() {
        if (!this.edfData) return;
        this.renderer.setViewport(0, this.duration);
    }

    _panViewport(fraction) {
        if (!this.edfData) return;
        const windowDuration = this.renderer.viewportEnd - this.renderer.viewportStart;
        const delta = windowDuration * fraction;
        let newStart = this.renderer.viewportStart + delta;
        let newEnd = this.renderer.viewportEnd + delta;
        // 确保不超出范围
        if (newEnd > this.duration) {
            newEnd = this.duration;
            newStart = newEnd - windowDuration;
        }
        if (newStart < 0) {
            newStart = 0;
            newEnd = newStart + windowDuration;
        }
        this.renderer.setViewport(newStart, newEnd);
        this._updateTimeDisplay(newStart, newEnd);
    }

    _setStatus(message, type) {
        const el = document.getElementById('status-bar');
        el.textContent = message;
        el.className = `status-bar status-${type || 'info'}`;
    }

    _parseEDFDateTime(dateStr, timeStr) {
        try {
            const dateParts = dateStr.split('.');
            const timeParts = timeStr.split('.');
            if (dateParts.length < 3 || timeParts.length < 3) return null;
            let year = parseInt(dateParts[2]);
            if (year < 100) year += year < 85 ? 2000 : 1900;
            const month = parseInt(dateParts[1]) - 1;
            const day = parseInt(dateParts[0]);
            const hour = parseInt(timeParts[0]);
            const minute = parseInt(timeParts[1]);
            const second = parseInt(timeParts[2]);
            if (isNaN(year) || isNaN(month) || isNaN(day) ||
                isNaN(hour) || isNaN(minute) || isNaN(second)) return null;
            return new Date(year, month, day, hour, minute, second);
        } catch {
            return null;
        }
    }

    _parseTime(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return null;
        // 如果包含冒号，解析为绝对时间（HH:MM:SS 或 H:MM:SS）
        if (timeStr.includes(':')) {
            // 有 recordingStart 时，解析为绝对时间
            if (this.recordingStart) {
                const parts = timeStr.split(':');
                if (parts.length === 3) {
                    const h = parseInt(parts[0]);
                    const m = parseInt(parts[1]);
                    const s = parseFloat(parts[2]);
                    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
                    const targetDate = new Date(this.recordingStart);
                    targetDate.setHours(h, m, Math.floor(s), (s % 1) * 1000);
                    const diffMs = targetDate.getTime() - this.recordingStart.getTime();
                    return { type: 'goto', value: diffMs / 1000 };
                }
            }
            return null;
        }
        // 不含冒号，解析为从当前时间加的秒数
        const delta = parseFloat(timeStr);
        if (isNaN(delta)) return null;
        return { type: 'add', value: delta };
    }

    _gotoTime(parsed) {
        if (!parsed) return;
        const { type, value } = parsed;
        const windowDuration = this.renderer.viewportEnd - this.renderer.viewportStart;
        let targetSeconds;
        if (type === 'add') {
            // 从当前时间加上 delta 秒
            const currentCenter = (this.renderer.viewportStart + this.renderer.viewportEnd) / 2;
            targetSeconds = currentCenter + value;
        } else {
            // 跳转到绝对时间
            targetSeconds = value;
        }
        // 限制在有效范围内
        targetSeconds = Math.max(0, Math.min(this.duration, targetSeconds));
        let newStart = targetSeconds - windowDuration / 2;
        let newEnd = targetSeconds + windowDuration / 2;
        // 确保不超出范围
        if (newEnd > this.duration) {
            newEnd = this.duration;
            newStart = newEnd - windowDuration;
        }
        if (newStart < 0) {
            newStart = 0;
            newEnd = newStart + windowDuration;
        }
        this.renderer.setViewport(newStart, newEnd);
        this._updateTimeDisplay(newStart, newEnd);
        this._setStatus(`已${type === 'add' ? '加' : '跳转'}到 ${this._formatTime(targetSeconds)}`, 'info');
    }

    _formatTime(seconds) {
        if (seconds == null || isNaN(seconds)) return '0:00';
        if (this.recordingStart) {
            const ms = this.recordingStart.getTime() + seconds * 1000;
            const d = new Date(ms);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            const fff = String(d.getMilliseconds()).padStart(3, '0');
            return `${hh}:${mm}:${ss}.${fff}`;
        }
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    _formatTimeFull(seconds) {
        if (seconds == null || isNaN(seconds)) return '--:--:--';
        if (this.recordingStart) {
            const ms = this.recordingStart.getTime() + seconds * 1000;
            const d = new Date(ms);
            const yyyy = d.getFullYear();
            const MM = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            const fff = String(d.getMilliseconds()).padStart(3, '0');
            return `${yyyy}.${MM}.${dd} ${hh}:${mm}:${ss}.${fff}`;
        }
        return this._formatTime(seconds);
    }

    async _checkAutosave(edfFileName) {
        if (!window.electronAPI || !edfFileName) return null;
        const result = await window.electronAPI.loadAutosave(edfFileName);
        if (!result.success || !result.data) return null;
        const ad = result.data;
        if (!ad.edfFileName || ad.annotations.length === 0) return null;
        return ad;
    }

    _startAutosave() {
        this._stopAutosave();
        this._autosaveTimer = setInterval(() => {
            this._doAutosave();
        }, 30000);
    }

    _stopAutosave() {
        if (this._autosaveTimer) {
            clearInterval(this._autosaveTimer);
            this._autosaveTimer = null;
        }
    }

    async _doAutosave() {
        if (!window.electronAPI || !this.currentFile) return;
        // 将 badChannels Map 转为可序列化的数组
        const badChannelsArr = [];
        for (const [name, info] of this.badChannels) {
            badChannelsArr.push({ name, ...info });
        }
        const data = {
            edfFileName: this.currentFile,
            duration: this.duration || 0,
            sfreq: this.sfreq || 0,
            channels: this.channels ? this.channels.map(ch => ch.name) : [],
            annotations: this.annotations || [],
            badChannels: badChannelsArr,
            viewportStart: this.renderer ? this.renderer.viewportStart : 0,
        };
        await window.electronAPI.saveAutosave(data);
    }

    _applyAutosaveData(ad) {
        // 直接恢复标注，渲染时会根据模式自动过滤
        this.annotations = ad.annotations || [];
        // 恢复坏道标记
        if (ad.badChannels && Array.isArray(ad.badChannels)) {
            for (const bc of ad.badChannels) {
                this.badChannels.set(bc.name, {
                    reason: bc.reason || 'manual',
                    type: bc.type || 'other',
                    note: bc.note || '',
                });
            }
        }
        this._updateAnnotationsList();
        this._updateChannelList();
        if (this.renderer) {
            this.renderer.setAnnotations(this.annotations);
            this.renderer.render();
        }
    }

    _showBadChannelsPanel() {
        if (this.channels.length === 0) {
            this._setStatus('请先加载 EDF 文件', 'warning');
            return;
        }

        const modal = document.getElementById('bad-channels-modal');
        modal.classList.remove('hidden');

        this._renderBadChannelsList();

        // 绑定按钮事件（只绑定一次）
        if (!this._bcPanelBound) {
            this._bcPanelBound = true;
            document.getElementById('bad-channels-close').addEventListener(
                'click', () => modal.classList.add('hidden')
            );
            document.getElementById('btn-bc-export').addEventListener(
                'click', () => this._exportBadChannels()
            );
            document.getElementById('btn-bc-import').addEventListener(
                'click', () => this._importBadChannelsDialog()
            );
            document.getElementById('btn-bc-clear').addEventListener(
                'click', () => {
                    this.badChannels.clear();
                    this._renderBadChannelsList();
                    this._updateChannelList();
                    this._updateChannelLabels();
                    this._setStatus('已清空所有坏道标记', 'info');
                }
            );
            document.getElementById('btn-bc-redetect').addEventListener(
                'click', () => {
                    this._evaluateChannelQuality();
                    this._renderBadChannelsList();
                    this._updateChannelList();
                    this._updateChannelLabels();
                    this._setStatus(
                        `重新检测完成，发现 ${this.badChannels.size} 个坏道`,
                        'info'
                    );
                }
            );
        }
    }

    _renderBadChannelsList() {
        const list = document.getElementById('bad-channels-list');
        list.innerHTML = '';

        if (this.badChannels.size === 0) {
            list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">未检测到坏道</div>';
            return;
        }

        for (const [name, info] of this.badChannels) {
            const typeDef = App.BAD_CHANNEL_TYPES.find(t => t.id === info.type);
            const typeName = typeDef ? typeDef.name : info.type;
            const typeColor = typeDef ? typeDef.color : '#607d8b';

            const row = document.createElement('div');
            row.className = 'bc-list-row';

            const dot = document.createElement('span');
            dot.className = 'bc-type-dot';
            dot.style.backgroundColor = typeColor;

            const chName = document.createElement('span');
            chName.className = 'bc-ch-name';
            chName.textContent = name;

            const typeTag = document.createElement('span');
            typeTag.className = 'bc-type-tag';
            typeTag.textContent = typeName;
            typeTag.style.color = typeColor;
            typeTag.style.backgroundColor = typeColor + '22';

            const reasonTag = document.createElement('span');
            reasonTag.className = 'bc-reason-tag';
            reasonTag.textContent = info.reason === 'auto' ? '自动' : '手动';

            if (info.note) {
                const noteTag = document.createElement('span');
                noteTag.className = 'bc-note-tag';
                noteTag.textContent = info.note;
                noteTag.title = info.note;
                row.appendChild(dot);
                row.appendChild(chName);
                row.appendChild(typeTag);
                row.appendChild(reasonTag);
                row.appendChild(noteTag);
            } else {
                row.appendChild(dot);
                row.appendChild(chName);
                row.appendChild(typeTag);
                row.appendChild(reasonTag);
            }

            const removeBtn = document.createElement('button');
            removeBtn.className = 'bc-remove-btn';
            removeBtn.textContent = '×';
            removeBtn.title = '移除';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.badChannels.delete(name);
                this._renderBadChannelsList();
                this._updateChannelList();
                this._updateChannelLabels();
            });
            row.appendChild(removeBtn);

            // 点击行展开波形预览
            row.addEventListener('click', () => {
                this._toggleBadChannelPreview(name, row);
            });

            list.appendChild(row);
        }
    }

    // 展开/收起坏道波形预览
    _toggleBadChannelPreview(channelName, rowEl) {
        // 查找已有的预览
        const next = rowEl.nextElementSibling;
        if (next && next.classList.contains('bc-preview-row')) {
            next.remove();
            return;
        }

        const previewRow = document.createElement('div');
        previewRow.className = 'bc-preview-row';

        const canvas = document.createElement('canvas');
        canvas.className = 'bc-preview-canvas';
        canvas.width = 420;
        canvas.height = 80;
        previewRow.appendChild(canvas);

        // 按钮行
        const btnRow = document.createElement('div');
        btnRow.className = 'bc-preview-btns';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.style.fontSize = '10px';
        confirmBtn.textContent = '确认坏道';
        confirmBtn.addEventListener('click', () => {
            // 确认为手动标记，防止重新检测时被清除
            const existing = this.badChannels.get(channelName);
            if (existing && existing.reason === 'auto') {
                existing.reason = 'manual';
            }
            this._renderBadChannelsList();
            this._updateChannelList();
            this._setStatus(`已确认坏道: ${channelName}`, 'info');
        });

        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn btn-secondary';
        restoreBtn.style.fontSize = '10px';
        restoreBtn.textContent = '恢复正常';
        restoreBtn.addEventListener('click', () => {
            this.badChannels.delete(channelName);
            this._renderBadChannelsList();
            this._updateChannelList();
            this._updateChannelLabels();
            this._setStatus(`已恢复通道: ${channelName}`, 'info');
        });

        btnRow.appendChild(confirmBtn);
        btnRow.appendChild(restoreBtn);
        previewRow.appendChild(btnRow);

        rowEl.after(previewRow);

        // 绘制波形
        this._drawBadChannelPreview(channelName, canvas);
    }

    // 绘制坏道波形预览
    _drawBadChannelPreview(channelName, canvas) {
        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;
        const ch = channels.find(c => c.name === channelName);
        if (!ch || !ch.data || ch.data.length === 0) {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#666';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('无数据', canvas.width / 2, canvas.height / 2);
            return;
        }

        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const data = ch.data;
        const len = data.length;

        // 清空
        ctx.clearRect(0, 0, w, h);

        // 背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, w, h);

        // 零线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // 计算统计量（用于标注）
        let min = Infinity, max = -Infinity, sum = 0, sumSq = 0;
        for (let i = 0; i < len; i++) {
            const v = data[i];
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v;
            sumSq += v * v;
        }
        const mean = sum / len;
        const std = Math.sqrt(Math.max(0, sumSq / len - mean * mean));
        const ptp = max - min;

        // 绘制波形
        const ptpSafe = Math.max(ptp, 1e-10);
        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 1;
        ctx.beginPath();

        // 降采样绘制
        const step = Math.max(1, Math.floor(len / w));
        for (let px = 0; px < w; px++) {
            const idx = Math.min(px * step, len - 1);
            const v = data[idx];
            const y = h / 2 - ((v - mean) / ptpSafe) * (h * 0.42);
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
        }
        ctx.stroke();

        // 统计信息
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`μV均值: ${mean.toFixed(1)}  标准差: ${std.toFixed(1)}  峰峰值: ${ptp.toFixed(1)}`, 6, 12);
    }

    // ── 时频分析 (Spectrogram) ────────────────────────────────────────────

    _showSpectrogramPanel() {
        if (this.channels.length === 0) {
            this._setStatus('请先加载 EDF 文件', 'warning');
            return;
        }

        const modal = document.getElementById('spectrogram-modal');
        modal.classList.remove('hidden');

        const channelSelect = document.getElementById('spectrogram-channel-select');
        channelSelect.innerHTML = '';
        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;
        for (const ch of channels) {
            const opt = document.createElement('option');
            opt.value = ch.name;
            opt.textContent = ch.name;
            channelSelect.appendChild(opt);
        }

        document.getElementById('spectrogram-close').onclick = () => {
            modal.classList.add('hidden');
        };

        modal.onclick = (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        };

        // 延迟一帧渲染，确保容器已完成布局
        requestAnimationFrame(() => this._updateSpectrogram());

        const ids = [
            'spectrogram-channel-select',
            'spectrogram-window-select',
            'spectrogram-cmap-select',
            'spectrogram-fmax-select',
            'spectrogram-scale-select',
        ];
        for (const id of ids) {
            document.getElementById(id).onchange = () => this._updateSpectrogram();
        }
    }

    _updateSpectrogram() {
        const channelName = document.getElementById('spectrogram-channel-select').value;
        const windowSec = parseFloat(
            document.getElementById('spectrogram-window-select').value
        );
        const cmapName = document.getElementById('spectrogram-cmap-select').value;
        const maxFreq = parseInt(
            document.getElementById('spectrogram-fmax-select').value
        );
        const scaleType = document.getElementById('spectrogram-scale-select').value;

        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;
        const channel = channels.find(c => c.name === channelName);
        if (!channel) return;

        const data = channel.data;
        const sfreq = channel.sfreq;

        const viewportStart = this.renderer.viewportStart;
        const viewportEnd = this.renderer.viewportEnd;
        const startSample = Math.floor(viewportStart * sfreq);
        const endSample = Math.ceil(viewportEnd * sfreq);
        const segmentData = data.slice(startSample, endSample);

        const n = segmentData.length;
        if (n < 2) {
            document.getElementById('spectrogram-info').textContent =
                '数据不足，请扩大视口范围';
            return;
        }

        // 计算 STFT
        const stftResult = this._computeSTFT(
            segmentData, sfreq, windowSec, maxFreq
        );
        if (!stftResult) return;

        // 渲染 Spectrogram
        this._renderSpectrogram(
            stftResult, viewportStart, viewportEnd,
            maxFreq, cmapName, scaleType
        );

        // 渲染同步波形
        this._renderSpectrogramWaveform(
            segmentData, sfreq, viewportStart, viewportEnd
        );
    }

    _computeSTFT(data, sfreq, windowSec, maxFreq) {
        const windowLen = Math.floor(windowSec * sfreq);
        const stepLen = Math.floor(windowLen * 0.5); // 50% 重叠
        const fftSize = this._nextPow2(windowLen);
        const freqRes = sfreq / fftSize;
        const maxFreqBin = Math.min(
            Math.ceil(maxFreq / freqRes), fftSize / 2
        );

        if (data.length < windowLen) return null;

        const frames = [];
        for (let start = 0; start + windowLen <= data.length; start += stepLen) {
            const frame = data.slice(start, start + windowLen);
            const spectrum = this._computeFFT(frame, fftSize, 'hann');
            frames.push(Array.from(spectrum.slice(0, maxFreqBin)));
        }

        return {
            frames,
            freqRes,
            maxFreqBin,
            timeStep: stepLen / sfreq,
            frameCount: frames.length,
            windowLen,
        };
    }

    // 色彩映射表（查找表插值）
    _getColorMap(name, value) {
        const v = Math.max(0, Math.min(1, value));
        // 各色彩映射的关键点 [position, r, g, b]
        const tables = {
            viridis: [
                [0.0, 68, 1, 84], [0.1, 72, 35, 116], [0.2, 64, 67, 135],
                [0.3, 52, 94, 141], [0.4, 41, 120, 142], [0.5, 32, 144, 140],
                [0.6, 34, 167, 132], [0.7, 68, 190, 112], [0.8, 121, 209, 81],
                [0.9, 189, 222, 38], [1.0, 253, 231, 37],
            ],
            hot: [
                [0.0, 0, 0, 0], [0.33, 255, 0, 0],
                [0.67, 255, 255, 0], [1.0, 255, 255, 255],
            ],
            jet: [
                [0.0, 0, 0, 128], [0.125, 0, 0, 255],
                [0.375, 0, 255, 255], [0.625, 255, 255, 0],
                [0.875, 255, 0, 0], [1.0, 128, 0, 0],
            ],
            inferno: [
                [0.0, 0, 0, 4], [0.1, 22, 6, 50], [0.2, 66, 10, 104],
                [0.3, 106, 23, 110], [0.4, 147, 38, 103],
                [0.5, 188, 55, 84], [0.6, 221, 81, 58],
                [0.7, 243, 118, 27], [0.8, 252, 165, 10],
                [0.9, 246, 215, 70], [1.0, 252, 255, 164],
            ],
        };

        const table = tables[name] || tables.viridis;

        // 找到 v 所在的区间并线性插值
        for (let i = 0; i < table.length - 1; i++) {
            if (v <= table[i + 1][0]) {
                const t = (v - table[i][0]) /
                          (table[i + 1][0] - table[i][0]);
                return [
                    Math.round(table[i][1] + t * (table[i + 1][1] - table[i][1])),
                    Math.round(table[i][2] + t * (table[i + 1][2] - table[i][2])),
                    Math.round(table[i][3] + t * (table[i + 1][3] - table[i][3])),
                ];
            }
        }
        return [table[table.length - 1][1],
                table[table.length - 1][2],
                table[table.length - 1][3]];
    }

    _renderSpectrogram(stftResult, startTime, endTime,
                        maxFreq, cmapName, scaleType) {
        const canvas = document.getElementById('spectrogram-canvas');
        const ctx = canvas.getContext('2d');
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth;
        const w = Math.max(400, containerWidth);
        const specH = 280;
        const colorBarW = 60;
        const padding = { top: 25, right: colorBarW + 10, bottom: 35, left: 55 };
        const plotW = w - padding.left - padding.right;
        const plotH = specH - padding.top - padding.bottom;

        canvas.width = w;
        canvas.height = specH;
        canvas.style.width = w + 'px';
        canvas.style.height = specH + 'px';

        // 背景
        ctx.fillStyle = '#0a1628';
        ctx.fillRect(0, 0, w, specH);

        const { frames, freqRes, frameCount } = stftResult;
        if (frameCount === 0) return;

        // 计算功率矩阵
        const powerMatrix = [];
        let minPower = Infinity, maxPower = -Infinity;
        let maxMagnitude = 0;
        for (let t = 0; t < frameCount; t++) {
            powerMatrix[t] = [];
            for (let f = 0; f < frames[t].length; f++) {
                const p = frames[t][f] * frames[t][f]; // 功率
                const db = 10 * Math.log10(Math.max(p, 1e-20));
                powerMatrix[t][f] = db;
                if (db < minPower) minPower = db;
                if (db > maxPower) maxPower = db;
                if (frames[t][f] > maxMagnitude) maxMagnitude = frames[t][f];
            }
        }

        // 限制动态范围（底部截断 -80dB）
        const range = maxPower - minPower;
        const dbFloor = maxPower - Math.min(range, 80);

        // 用离屏 Canvas 绘制热力图，再 drawImage 到主画布
        const offCanvas = document.createElement('canvas');
        offCanvas.width = plotW;
        offCanvas.height = plotH;
        const offCtx = offCanvas.getContext('2d');
        const imgData = offCtx.createImageData(plotW, plotH);
        const numFreqBins = frames[0].length;

        for (let py = 0; py < plotH; py++) {
            const freqIdx = Math.floor(
                (1 - py / plotH) * numFreqBins
            );
            const fIdx = Math.min(freqIdx, numFreqBins - 1);

            for (let px = 0; px < plotW; px++) {
                const tIdx = Math.floor((px / plotW) * frameCount);
                const t = Math.min(tIdx, frameCount - 1);

                let val;
                if (scaleType === 'dB') {
                    val = (powerMatrix[t][fIdx] - dbFloor) /
                          (maxPower - dbFloor);
                } else {
                    val = frames[t][fIdx] / Math.max(maxMagnitude, 1e-10);
                }
                val = Math.max(0, Math.min(1, val));

                const [r, g, b] = this._getColorMap(cmapName, val);
                const idx = (py * plotW + px) * 4;
                imgData.data[idx] = r;
                imgData.data[idx + 1] = g;
                imgData.data[idx + 2] = b;
                imgData.data[idx + 3] = 255;
            }
        }

        offCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(offCanvas, padding.left, padding.top);

        // 坐标轴
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(padding.left, padding.top, plotW, plotH);

        // 时间刻度
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        const duration = endTime - startTime;
        const timeTicks = 5;
        for (let i = 0; i <= timeTicks; i++) {
            const t = startTime + (duration * i / timeTicks);
            const x = padding.left + (plotW * i / timeTicks);
            ctx.fillText(t.toFixed(1) + 's', x, specH - 5);
            if (i > 0 && i < timeTicks) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.beginPath();
                ctx.moveTo(x, padding.top);
                ctx.lineTo(x, padding.top + plotH);
                ctx.stroke();
            }
        }

        // 频率刻度
        ctx.textAlign = 'right';
        const freqTicks = 5;
        for (let i = 0; i <= freqTicks; i++) {
            const f = maxFreq * i / freqTicks;
            const y = padding.top + plotH - (plotH * i / freqTicks);
            ctx.fillText(f.toFixed(0) + 'Hz', padding.left - 5, y + 3);
            if (i > 0 && i < freqTicks) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(padding.left + plotW, y);
                ctx.stroke();
            }
        }

        // 色条
        const cbX = padding.left + plotW + 10;
        const cbW = 15;
        for (let py = 0; py < plotH; py++) {
            const v = 1 - py / plotH;
            const [r, g, b] = this._getColorMap(cmapName, v);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(cbX, padding.top + py, cbW, 1);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.strokeRect(cbX, padding.top, cbW, plotH);

        // 色条刻度
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + plotH - (plotH * i / 4);
            let label;
            if (scaleType === 'dB') {
                label = (dbFloor + (maxPower - dbFloor) * i / 4).toFixed(0);
            } else {
                label = (maxMagnitude * i / 4).toFixed(1);
            }
            ctx.fillText(label, cbX + cbW + 3, y + 3);
        }

        // 轴标签
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Time', padding.left + plotW / 2, specH - 0);
        ctx.save();
        ctx.translate(12, padding.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Frequency', 0, 0);
        ctx.restore();

        // 保存渲染参数供鼠标交互使用
        this._spectrogramParams = {
            stftResult, startTime, endTime, maxFreq,
            cmapName, scaleType, padding, plotW, plotH,
            dbFloor, maxPower, powerMatrix,
        };
    }

    _renderSpectrogramWaveform(data, sfreq, startTime, endTime) {
        const canvas = document.getElementById('spectrogram-waveform-canvas');
        const ctx = canvas.getContext('2d');
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth;
        const w = Math.max(400, containerWidth);
        const h = 60;
        const padding = { top: 5, right: 70, bottom: 15, left: 55 };
        const plotW = w - padding.left - padding.right;
        const plotH = h - padding.top - padding.bottom;

        canvas.width = w;
        canvas.height = h;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        ctx.fillStyle = '#0a1628';
        ctx.fillRect(0, 0, w, h);

        // 零线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top + plotH / 2);
        ctx.lineTo(padding.left + plotW, padding.top + plotH / 2);
        ctx.stroke();

        // 统计量
        let min = Infinity, max = -Infinity, sum = 0;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
            sum += data[i];
        }
        const mean = sum / data.length;
        const ptp = Math.max(max - min, 1e-10);

        // 绘制波形
        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const step = Math.max(1, Math.floor(data.length / plotW));
        for (let px = 0; px < plotW; px++) {
            const idx = Math.min(px * step, data.length - 1);
            const v = data[idx];
            const y = padding.top + plotH / 2 -
                      ((v - mean) / ptp) * (plotH * 0.42);
            if (px === 0) ctx.moveTo(padding.left + px, y);
            else ctx.lineTo(padding.left + px, y);
        }
        ctx.stroke();

        // 标签
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waveform', padding.left + plotW / 2, h - 2);
    }

    // ── 全局波形概览条 (Overview Bar) ────────────────────────────────────

    _initOverviewInteraction() {
        const canvas = document.getElementById('overview-canvas');
        let dragging = false;
        let dragStartX = 0;
        let dragStartViewportStart = 0;

        canvas.addEventListener('mousedown', (e) => {
            if (!this.renderer || this.renderer.totalDuration <= 0) return;
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const w = rect.width;

            const totalDur = this.renderer.totalDuration;
            const vpStart = this.renderer.viewportStart;
            const vpEnd = this.renderer.viewportEnd;
            const vpWidth = vpEnd - vpStart;

            const vpStartPx = (vpStart / totalDur) * w;
            const vpEndPx = (vpEnd / totalDur) * w;

            if (mx >= vpStartPx && mx <= vpEndPx) {
                // 点击在视窗框内，进入拖拽模式
                dragging = true;
                dragStartX = mx;
                dragStartViewportStart = vpStart;
            } else {
                // 点击在视窗外，跳转视窗中心到点击位置
                const clickTime = (mx / w) * totalDur;
                let newStart = clickTime - vpWidth / 2;
                newStart = Math.max(0, Math.min(newStart, totalDur - vpWidth));
                this.renderer.setViewport(newStart, newStart + vpWidth);
                this._updateTimeDisplay(newStart, newStart + vpWidth);
                this._updateLabelPositions();
                this._renderOverview();
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging || !this.renderer) return;
            const canvas = document.getElementById('overview-canvas');
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const w = rect.width;
            const totalDur = this.renderer.totalDuration;
            const vpWidth = this.renderer.viewportEnd - this.renderer.viewportStart;

            const dx = mx - dragStartX;
            const dt = (dx / w) * totalDur;
            let newStart = dragStartViewportStart + dt;
            newStart = Math.max(0, Math.min(newStart, totalDur - vpWidth));
            this.renderer.setViewport(newStart, newStart + vpWidth);
            this._updateTimeDisplay(newStart, newStart + vpWidth);
            this._updateLabelPositions();
            this._renderOverview();
        });

        window.addEventListener('mouseup', () => {
            dragging = false;
        });

        canvas.addEventListener('wheel', (e) => {
            if (!this.renderer) return;
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const w = rect.width;
            const totalDur = this.renderer.totalDuration;
            const mouseTime = (mx / w) * totalDur;

            const range = this.renderer.viewportEnd - this.renderer.viewportStart;
            const delta = e.deltaY > 0 ? 1.15 : 1 / 1.15;
            const newRange = Math.max(0.5, Math.min(totalDur, range * delta));

            let newStart = mouseTime - (mouseTime - this.renderer.viewportStart) * (newRange / range);
            let newEnd = newStart + newRange;
            if (newStart < 0) { newStart = 0; newEnd = newRange; }
            if (newEnd > totalDur) { newEnd = totalDur; newStart = newEnd - newRange; }

            this.renderer.setViewport(newStart, newEnd);
            this._updateTimeDisplay(newStart, newEnd);
            this._updateLabelPositions();
            this._renderOverview();
        });
    }

    _renderOverview() {
        const canvas = document.getElementById('overview-canvas');
        if (!canvas || !this.renderer || this.renderer.totalDuration <= 0) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // 背景
        ctx.fillStyle = 'rgba(8, 12, 24, 0.95)';
        ctx.fillRect(0, 0, w, h);

        const totalDur = this.renderer.totalDuration;
        const vpStart = this.renderer.viewportStart;
        const vpEnd = this.renderer.viewportEnd;

        // 绘制标注色块
        this._renderOverviewAnnotations(ctx, w, h, totalDur);

        // 绘制时间刻度
        this._renderOverviewTicks(ctx, w, h, totalDur);

        // 绘制视窗框
        const vpStartPx = (vpStart / totalDur) * w;
        const vpEndPx = (vpEnd / totalDur) * w;

        // 视窗外遮罩
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, vpStartPx, h);
        ctx.fillRect(vpEndPx, 0, w - vpEndPx, h);

        // 视窗框边框
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vpStartPx, 0, vpEndPx - vpStartPx, h);

        // 视窗框左右边缘手柄
        const handleH = 8;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        // 左手柄
        ctx.fillRect(vpStartPx - 1, h / 2 - handleH / 2, 3, handleH);
        // 右手柄
        ctx.fillRect(vpEndPx - 2, h / 2 - handleH / 2, 3, handleH);
    }

    _renderOverviewAnnotations(ctx, w, h, totalDur) {
        if (!this.annotations || this.annotations.length === 0) return;

        for (const ann of this.annotations) {
            const labelType = this._labelTypes.find(t => t.id === ann.label);
            if (!labelType) continue;

            const startPx = (ann.start / totalDur) * w;
            const endPx = (ann.end / totalDur) * w;

            const [r, g, b] = labelType.color;
            ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.35)`;
            ctx.fillRect(startPx, 0, Math.max(endPx - startPx, 1), h);
        }
    }

    _renderOverviewTicks(ctx, w, h, totalDur) {
        // 自适应刻度间隔
        const intervals = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
        const targetTickCount = Math.max(4, Math.floor(w / 100));
        let interval = intervals[intervals.length - 1];
        for (const iv of intervals) {
            if (totalDur / iv <= targetTickCount * 1.5) {
                interval = iv;
                break;
            }
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 1;

        const tickH = 6;
        for (let t = 0; t <= totalDur; t += interval) {
            const x = (t / totalDur) * w;
            ctx.beginPath();
            ctx.moveTo(x, h - tickH);
            ctx.lineTo(x, h);
            ctx.stroke();

            const label = this._formatTimeShort(t);
            ctx.fillText(label, x, h - tickH - 2);
        }
    }

    _formatTimeShort(seconds) {
        if (seconds < 60) return seconds + 's';
        if (seconds < 3600) {
            const m = Math.floor(seconds / 60);
            const s = Math.round(seconds % 60);
            return s > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${m}m`;
        }
        const h = Math.floor(seconds / 3600);
        const m = Math.round((seconds % 3600) / 60);
        return m > 0 ? `${h}h${m}m` : `${h}h`;
    }

    _initSpectrogramMouseInteraction() {
        const canvas = document.getElementById('spectrogram-canvas');
        const infoEl = document.getElementById('spectrogram-info');

        canvas.addEventListener('mousemove', (e) => {
            if (!this._spectrogramParams) return;
            const p = this._spectrogramParams;
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const mx = (e.clientX - rect.left);
            const my = (e.clientY - rect.top);

            const px = mx - p.padding.left;
            const py = my - p.padding.top;

            if (px < 0 || px >= p.plotW || py < 0 || py >= p.plotH) {
                infoEl.textContent = '';
                return;
            }

            const duration = p.endTime - p.startTime;
            const time = p.startTime + (px / p.plotW) * duration;
            const freq = p.maxFreq * (1 - py / p.plotH);

            const tIdx = Math.min(
                Math.floor((px / p.plotW) * p.stftResult.frameCount),
                p.stftResult.frameCount - 1
            );
            const fIdx = Math.min(
                Math.floor((1 - py / p.plotH) * p.stftResult.frames[0].length),
                p.stftResult.frames[0].length - 1
            );

            const power = p.powerMatrix[tIdx][fIdx];
            const unit = p.scaleType === 'dB' ? 'dB' : '';
            infoEl.innerHTML =
                `时间: <b>${time.toFixed(2)}s</b> &nbsp; ` +
                `频率: <b>${freq.toFixed(1)}Hz</b> &nbsp; ` +
                `功率: <b>${power.toFixed(1)}${unit}</b>`;
        });

        canvas.addEventListener('mouseleave', () => {
            infoEl.textContent = '';
        });
    }

    _showFFTPanel() {
        if (this.channels.length === 0) {
            this._setStatus('请先加载 EDF 文件', 'warning');
            return;
        }
        const modal = document.getElementById('fft-modal');
        modal.classList.remove('hidden');

        const channelSelect = document.getElementById('fft-channel-select');
        channelSelect.innerHTML = '';
        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;
        for (const ch of channels) {
            const opt = document.createElement('option');
            opt.value = ch.name;
            opt.textContent = ch.name;
            channelSelect.appendChild(opt);
        }

        document.getElementById('fft-close').onclick = () => {
            modal.classList.add('hidden');
        };

        modal.onclick = (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        };

        this._updateFFTChart();

        document.getElementById('fft-channel-select').onchange = () => this._updateFFTChart();
        document.getElementById('fft-window-select').onchange = () => this._updateFFTChart();
        document.getElementById('fft-scale-select').onchange = () => this._updateFFTChart();
    }

    _updateFFTChart() {
        const channelName = document.getElementById('fft-channel-select').value;
        const windowType = document.getElementById('fft-window-select').value;
        const scaleType = document.getElementById('fft-scale-select').value;

        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;
        const channel = channels.find(c => c.name === channelName);
        if (!channel) return;

        const data = channel.data;
        const sfreq = channel.sfreq;

        const viewportStart = this.renderer.viewportStart;
        const viewportEnd = this.renderer.viewportEnd;
        const startSample = Math.floor(viewportStart * sfreq);
        const endSample = Math.ceil(viewportEnd * sfreq);
        const segmentData = data.slice(startSample, endSample);

        const n = segmentData.length;
        if (n < 2) {
            document.getElementById('fft-info').textContent = '数据不足，请扩大视口范围';
            return;
        }

        const fftSize = this._nextPow2(n);
        const spectrum = this._computeFFT(segmentData, fftSize, windowType);

        const canvas = document.getElementById('fft-canvas');
        const ctx = canvas.getContext('2d');
        const container = canvas.parentElement;
        
        const containerWidth = container.clientWidth - 24; // 减去 padding
        const w = Math.max(300, containerWidth);
        const h = 300;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);

        const padding = { top: 20, right: 20, bottom: 45, left: 55 };
        const plotW = w - padding.left - padding.right;
        const plotH = h - padding.top - padding.bottom;

        ctx.fillStyle = '#0a1628';
        ctx.fillRect(0, 0, w, h);

        const maxFreq = Math.min(sfreq / 2, 100);
        const freqResolution = (sfreq / 2) / (fftSize / 2);
        const startFreq = 0.5;

        let peaks = [];
        let maxPower = -Infinity;
        let minPower = Infinity;

        for (let i = 1; i < fftSize / 2; i++) {
            const freq = i * freqResolution;
            if (freq > maxFreq) break;
            if (freq < startFreq) continue;
            let power = spectrum[i];
            if (scaleType === 'log') {
                power = 10 * Math.log10(power + 1e-10);
            }
            peaks.push({ freq, power, linearPower: spectrum[i] });
            if (power > maxPower) maxPower = power;
            if (power < minPower) minPower = power;
        }

        if (maxPower === -Infinity || peaks.length === 0) {
            document.getElementById('fft-info').textContent = '数据不足或计算错误';
            return;
        }

        const yRange = Math.max(maxPower - minPower, 1);
        const yMin = minPower - yRange * 0.05;

        const xScale = (freq) => padding.left + (freq / maxFreq) * plotW;
        const yScale = (power) => {
            const normalized = (power - yMin) / yRange;
            return padding.top + (1 - Math.min(1, Math.max(0, normalized))) * plotH;
        };

        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 1;
        const freqStep = maxFreq <= 20 ? 5 : maxFreq <= 50 ? 10 : 20;
        for (let freq = 0; freq <= maxFreq; freq += freqStep) {
            const x = xScale(freq);
            if (x >= padding.left && x <= w - padding.right) {
                ctx.beginPath();
                ctx.moveTo(x, padding.top);
                ctx.lineTo(x, h - padding.bottom);
                ctx.stroke();
            }
        }

        // 计算合适的Y轴步长，确保刻度间距至少20像素
        let yStep = yRange / 10;
        if (scaleType === 'log') {
            yStep = yRange <= 20 ? 5 : yRange <= 50 ? 10 : 20;
        } else {
            // 线性坐标：使用科学计数法友好的步长
            const magnitude = Math.pow(10, Math.floor(Math.log10(yStep)));
            const normalized = yStep / magnitude;
            if (normalized < 2) yStep = 2 * magnitude;
            else if (normalized < 5) yStep = 5 * magnitude;
            else yStep = 10 * magnitude;
            yStep = Math.max(yStep, magnitude * 0.01); // 防止步长太小
        }
        
        // 计算第一个刻度值
        const firstYTick = Math.ceil(yMin / yStep) * yStep;
        for (let val = firstYTick; val <= maxPower; val += yStep) {
            const y = yScale(val);
            if (y >= padding.top && y <= h - padding.bottom) {
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(w - padding.right, y);
                ctx.stroke();
            }
        }

        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        let first = true;
        for (let i = 0; i < peaks.length; i++) {
            const { freq, power } = peaks[i];
            const x = xScale(freq);
            const y = yScale(power);
            if (first) {
                ctx.moveTo(x, y);
                first = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        const threshold = maxPower - (yRange * 0.25);
        const topPeaks = peaks.filter(p => p.power >= threshold).sort((a, b) => b.power - a.power).slice(0, 3);

        ctx.fillStyle = '#ff6b6b';
        for (const peak of topPeaks) {
            const x = xScale(peak.freq);
            const y = yScale(peak.power);
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = '#7ba3c4';
        ctx.font = '10px Cascadia Code, Consolas, monospace';
        ctx.textAlign = 'center';
        for (let freq = 0; freq <= maxFreq; freq += freqStep) {
            const x = xScale(freq);
            if (x >= padding.left && x <= w - padding.right - 20) {
                ctx.fillText(freq + '', x, h - padding.bottom + 14);
            }
        }
        ctx.fillText('Frequency (Hz)', w / 2, h - 5);

        ctx.textAlign = 'right';
        ctx.save();
        ctx.translate(12, h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText(scaleType === 'log' ? 'Power (dB)' : 'Power', 0, 0);
        ctx.restore();

        // Y轴标签绘制，使用智能格式化
        const formatValue = (val) => {
            if (Math.abs(val) < 0.001 && val !== 0) return val.toExponential(1);
            if (Math.abs(val) >= 1e6) return val.toExponential(1);
            if (Math.abs(val) >= 1000) return val.toFixed(0);
            if (Math.abs(val) >= 1) return val.toFixed(1);
            return val.toFixed(3);
        };

        for (let val = firstYTick; val <= maxPower; val += yStep) {
            const y = yScale(val);
            if (y >= padding.top + 10 && y <= h - padding.bottom - 5) {
                ctx.fillText(formatValue(val), padding.left - 6, y + 4);
            }
        }

        let peakText = '无明显峰值';
        if (topPeaks.length > 0) {
            const top = topPeaks[0];
            peakText = `峰值频率: <span class="peak-freq">${top.freq.toFixed(1)} Hz</span> (${top.power.toFixed(1)} ${scaleType === 'log' ? 'dB' : 'V'})`;
        }
        document.getElementById('fft-info').innerHTML = peakText;
    }

    _nextPow2(n) {
        let p = 1;
        while (p < n) p *= 2;
        return p;
    }

    _applyWindow(data, type) {
        const n = data.length;
        const windowed = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            let w = 1;
            if (type === 'hann') {
                w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
            } else if (type === 'hamming') {
                w = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
            } else if (type === 'blackman') {
                w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (n - 1));
            }
            windowed[i] = data[i] * w;
        }
        return windowed;
    }

    _computeFFT(data, fftSize, windowType) {
        const n = data.length;
        const real = new Float64Array(fftSize);
        const imag = new Float64Array(fftSize);

        const windowed = this._applyWindow(data, windowType);
        for (let i = 0; i < n; i++) {
            real[i] = windowed[i];
        }

        this._fft(real, imag);

        const spectrum = new Float64Array(fftSize / 2);
        for (let i = 0; i < fftSize / 2; i++) {
            spectrum[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        }
        return spectrum;
    }

    _fft(real, imag) {
        const n = real.length;
        if (n <= 1) return;

        for (let i = 0, j = 0; i < n; i++) {
            if (i < j) {
                let temp = real[i];
                real[i] = real[j];
                real[j] = temp;
                temp = imag[i];
                imag[i] = imag[j];
                imag[j] = temp;
            }
            let k = n >> 1;
            for (; (k >= 1) && (j >= k); k >>= 1) {
                j -= k;
            }
            if (k >= 1) j += k;
        }

        for (let len = 2; len <= n; len <<= 1) {
            const halfLen = len >> 1;
            const angle = -2 * Math.PI / len;
            const wReal = Math.cos(angle);
            const wImag = Math.sin(angle);
            for (let i = 0; i < n; i += len) {
                let uReal = 1;
                let uImag = 0;
                for (let jj = 0; jj < halfLen; jj++) {
                    const tReal = uReal * real[i + jj + halfLen] - uImag * imag[i + jj + halfLen];
                    const tImag = uReal * imag[i + jj + halfLen] + uImag * real[i + jj + halfLen];
                    real[i + jj + halfLen] = real[i + jj] - tReal;
                    imag[i + jj + halfLen] = imag[i + jj] - tImag;
                    real[i + jj] += tReal;
                    imag[i + jj] += tImag;
                    const tempReal = uReal * wReal - uImag * wImag;
                    const tempImag = uReal * wImag + uImag * wReal;
                    uReal = tempReal;
                    uImag = tempImag;
                }
            }
        }
    }
}

window.addEventListener('beforeunload', () => {
    if (window.app) {
        window.app._doAutosave();
        window.app._stopAutosave();
    }
});

window.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
