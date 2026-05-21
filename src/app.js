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
        this.annoPanelVisible = false;
        this.selectedAnnoChannel = null;
        this.annoStep = 0;
        this.invalidChannels = new Set();
        this.sensitivityUv = 100;
        this.originalChannels = null;
        this.recordingStart = null;
        this._lasso = null;
        this.undoStack = [];
        this.redoStack = [];
        this._autosaveTimer = null;

        this._initRenderer();
        this._bindEvents();
        this._bindElectronAPI();
        this._updateStepUI();
    }

    _initRenderer() {
        const canvas = document.getElementById('waveform-canvas');
        const timeAxisCanvas = document.getElementById('time-axis-canvas');
        this.renderer = new GLRenderer(canvas);
        this.renderer.setTimeAxisCanvas(timeAxisCanvas);

        this.renderer.onViewportChange = (start, end) => {
            this._updateTimeDisplay(start, end);
            this._updateLabelPositions();
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
        document.getElementById('btn-select-all').addEventListener('click', () => this._selectAllChannels());
        document.getElementById('btn-deselect-all').addEventListener('click', () => this._deselectAllChannels());
        document.getElementById('btn-bipolar').addEventListener('click', () => this._toggleBipolar());
        document.getElementById('btn-fixed-height').addEventListener('click', () => this._toggleFixedHeight());

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

        window.addEventListener('resize', () => {
            if (this.renderer) {
                this.renderer._resize();
                this.renderer.render();
                this._updateChannelLabels();
            }
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

    _evaluateChannelQuality() {
        this.invalidChannels = new Set();

        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;

        if (channels.length === 0) return;

        const stats = [];
        for (const ch of channels) {
            const data = ch.data;
            if (!data || data.length === 0) {
                this.invalidChannels.add(ch.name);
                continue;
            }

            let sum = 0;
            let sumSq = 0;
            let min = Infinity;
            let max = -Infinity;
            const len = data.length;
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

            const uniqueSet = new Set();
            for (let i = 0; i < len; i++) {
                uniqueSet.add(data[i]);
                if (uniqueSet.size > 10) break;
            }

            stats.push({
                name: ch.name, std, ptp,
                uniqueCount: uniqueSet.size
            });
        }

        if (stats.length === 0) return;

        const validStats = stats.filter(s => !this.invalidChannels.has(s.name));
        if (validStats.length === 0) return;

        const stds = validStats.map(s => s.std).sort((a, b) => a - b);
        const medianStd = stds[Math.floor(stds.length / 2)];

        const ptps = validStats.map(s => s.ptp).sort((a, b) => a - b);
        const medianPtp = ptps[Math.floor(ptps.length / 2)];

        if (medianStd <= 0 || medianPtp <= 0) return;

        for (const s of validStats) {
            const stdRatio = s.std / medianStd;
            const ptpRatio = s.ptp / medianPtp;

            if (s.uniqueCount <= 10) {
                this.invalidChannels.add(s.name);
                continue;
            }
            if (stdRatio < 0.5) {
                this.invalidChannels.add(s.name);
                continue;
            }
            if (ptpRatio < 0.5) {
                this.invalidChannels.add(s.name);
                continue;
            }
            if (stdRatio > 50) {
                this.invalidChannels.add(s.name);
                continue;
            }
        }
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

        this._evaluateChannelQuality();

        this._updateChannelList();
        this._selectDefaultChannels();
        this._updateAnnoChannelOptions();
        this._updateFileInfo(fileName, fileSize);
        this._updateAnnotationsList();

        this._setStatus(
            `已加载: ${fileName} | ${this.channels.length}通道` +
            (this.invalidChannels.size > 0
                ? ` (有效${this.channels.length - this.invalidChannels.size})`
                : '') +
            ` | ${this.sfreq.toFixed(0)}Hz | ${this.duration.toFixed(0)}s | ${parseTime}ms`,
            'success'
        );

        this._startAutosave();

        this._checkAutosave(fileName).then(ad => {
            if (!ad) return;
            this._showAutosaveModal(ad, fileName);
        });
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

        const selectAllRow = document.createElement('div');
        selectAllRow.className = 'channel-item select-all-row';

        const selectAllCb = document.createElement('input');
        selectAllCb.type = 'checkbox';
        selectAllCb.id = 'select-all-channels';
        const allSelected = channels.length > 0 &&
            this.selectedChannels.length === channels.length;
        selectAllCb.checked = allSelected;
        selectAllCb.addEventListener('change', () => {
            if (selectAllCb.checked) {
                this._selectAllChannels();
            } else {
                this._deselectAllChannels();
            }
        });

        const selectAllLabel = document.createElement('span');
        selectAllLabel.className = 'channel-name select-all-label';
        selectAllLabel.textContent = '全选';

        selectAllRow.appendChild(selectAllCb);
        selectAllRow.appendChild(selectAllLabel);
        container.appendChild(selectAllRow);

        const sorted = channels.slice().sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true })
        );

        for (const ch of sorted) {
            if (searchTerm && ch.name.toLowerCase().indexOf(searchTerm) === -1) continue;

            const div = document.createElement('div');
            div.className = 'channel-item';
            const isInvalid = this.invalidChannels.has(ch.name);
            if (isInvalid) {
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
            label.title = isInvalid
                ? `${ch.name} (无效通道: 信号异常)`
                : ch.name;

            div.appendChild(checkbox);
            div.appendChild(label);
            container.appendChild(div);
        }

        document.getElementById('channel-count').textContent =
            `${this.selectedChannels.length}/${channels.length}`;
    }

    _selectDefaultChannels() {
        const channels = this.showBipolar && this.bipolarChannels
            ? this.bipolarChannels : this.channels;

        this.selectedChannels = channels
            .filter(ch => !this.invalidChannels.has(ch.name))
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

        this.renderer.setChannels(selected, this.sfreq, this.duration);
        this.renderer.setAnnotations(this.annotations);
        this._applySensitivity(this.sensitivityUv);
        this._updateTimeDisplay(this.renderer.viewportStart, this.renderer.viewportEnd);
        this._updateChannelLabels();
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

            let maxNameWidth = 0;
            const tempSpan = document.createElement('span');
            tempSpan.style.fontFamily = "'Cascadia Code', 'Consolas', monospace";
            tempSpan.style.fontSize = fontSize + 'px';
            tempSpan.style.position = 'absolute';
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.whiteSpace = 'nowrap';
            document.body.appendChild(tempSpan);
            for (const ch of channels) {
                tempSpan.textContent = ch.name;
                maxNameWidth = Math.max(maxNameWidth, tempSpan.offsetWidth);
            }
            document.body.removeChild(tempSpan);

            const labelWidth = Math.min(200, Math.max(80, maxNameWidth + 12));
            container.style.width = labelWidth + 'px';

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
                span.title = ch.name;

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

            let maxNameWidth = 0;
            const tempSpan = document.createElement('span');
            tempSpan.style.fontFamily = "'Cascadia Code', 'Consolas', monospace";
            tempSpan.style.fontSize = adaptiveFontSize + 'px';
            tempSpan.style.position = 'absolute';
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.whiteSpace = 'nowrap';
            document.body.appendChild(tempSpan);
            for (const ch of channels) {
                tempSpan.textContent = ch.name;
                maxNameWidth = Math.max(maxNameWidth, tempSpan.offsetWidth);
            }
            document.body.removeChild(tempSpan);

            const labelWidth = Math.min(200, Math.max(80, maxNameWidth + 12));
            container.style.width = labelWidth + 'px';

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
                span.title = ch.name;

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
            this.annoStart = time;
            this.annoStartTime = time;
            this.annoEndTime = null;
            document.getElementById('anno-start').value = this._formatTime(time);
            document.getElementById('anno-end').value = '';
            this._setStatus(
                `起点: ${this._formatTime(time)}` +
                (channelName ? ` | 通道: ${channelName}` : '') +
                ' — 再次中键点击设置终点',
                'info'
            );
        } else {
            const start = Math.min(this.annoStart, time);
            const end = Math.max(this.annoStart, time);
            this.annoStartTime = start;
            this.annoEndTime = end;
            this.annoStart = null;
            this.annotationMode = false;
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

    _handleCanvasRightClick(e) {
        if (!this.edfData) return;

        if (this.annotationMode && this.annoStart !== null) {
            this.annoStart = null;
            this.annoStartTime = null;
            this.annoEndTime = null;
            document.getElementById('anno-start').value = '';
            document.getElementById('anno-end').value = '';
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
        const channel = channelInput.value || '';

        if (start === null || end === null || start >= end) {
            this._setStatus('无效的时间范围', 'error');
            return;
        }

        this._saveToHistory();

        let originalChannel = channel;
        if (this.showBipolar && this.bipolarChannels && channel) {
            const bp = this.bipolarChannels.find(c => c.name === channel);
            if (bp && bp.ch1 && bp.ch2) {
                originalChannel = `${bp.ch1} & ${bp.ch2}`;
            }
        }

        const note = document.getElementById('anno-note').value.trim();

        this.annotations.push({
            start, end, label, channel,
            originalChannel,
            note,
        });
        this._updateAnnotationsList();
        this.renderer.setAnnotations(this.annotations);
        this.renderer.render();
        this._setStatus(
            `已添加标注: ${this._formatTime(start)} - ${this._formatTime(end)} [${label}]` +
            (channel ? ` 通道: ${channel}` : ''),
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

            if (ann.channel) {
                const chSpan = document.createElement('span');
                chSpan.className = 'anno-channel';
                chSpan.textContent = ann.channel;
                row.appendChild(timeSpan);
                row.appendChild(chSpan);
            } else {
                row.appendChild(timeSpan);
            }

            const labelSpan = document.createElement('span');
            labelSpan.className = 'anno-label';
            labelSpan.textContent = ann.label;

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
            const ch = ann.originalChannel || ann.channel || 'ALL';
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
                const rawChannel = parts[0] === 'ALL' ? '' : parts[0];
                const startStr = parts[1];
                const endStr = parts[2];
                const label = parts[3] || 'other';
                const note = parts[4] || '';

                let start = this._parseAbsoluteTime(startStr);
                let end = this._parseAbsoluteTime(endStr);

                if (isNaN(start)) start = parseFloat(startStr);
                if (isNaN(end)) end = parseFloat(endStr);

                if (!isNaN(start) && !isNaN(end) && end > start) {
                    const channel = rawChannel.includes(' & ')
                        ? '' : rawChannel;
                    const originalChannel = rawChannel.includes(' & ')
                        ? rawChannel : rawChannel;
                    this.annotations.push({
                        start, end, label, channel,
                        originalChannel, note,
                    });
                    count++;
                }
            } else if (parts.length >= 3) {
                const start = parseFloat(parts[0]);
                const end = parseFloat(parts[1]);
                const label = parts[2] || 'other';
                let channel = '';

                if (parts.length >= 4 && isNaN(parseFloat(parts[2]))) {
                    channel = parts[2] === '全部' ? '' : parts[2];
                }

                const note = parts.length >= 5 ? parts[4] : '';

                if (!isNaN(start) && !isNaN(end) && end > start) {
                    this.annotations.push({ start, end, label, channel, note });
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
        const data = {
            edfFileName: this.currentFile,
            duration: this.duration || 0,
            sfreq: this.sfreq || 0,
            channels: this.channels ? this.channels.map(ch => ch.name) : [],
            annotations: this.annotations || [],
            viewportStart: this.renderer ? this.renderer.viewportStart : 0,
        };
        await window.electronAPI.saveAutosave(data);
    }

    _applyAutosaveData(ad) {
        this.annotations = ad.annotations || [];
        this._updateAnnotationsList();
        if (this.renderer) {
            this.renderer.setAnnotations(this.annotations);
            this.renderer.render();
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
