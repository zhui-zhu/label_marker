class EDFParser {
    static parse(arrayBuffer) {
        if (!arrayBuffer || arrayBuffer.byteLength < 256) {
            throw new Error(
                `File too small: ${arrayBuffer ? arrayBuffer.byteLength : 0} bytes ` +
                `(minimum 256 bytes for EDF header)`
            );
        }

        const view = new DataView(arrayBuffer);
        const header = EDFParser._parseHeader(view);
        if (!header) {
            throw new Error(
                `Invalid EDF header. ` +
                `File size: ${arrayBuffer.byteLength} bytes, ` +
                `First 16 bytes: ${EDFParser._hexDump(view, 0, 16)}`
            );
        }

        const signals = EDFParser._parseSignalsHeader(
            view, 256, header.numSignals
        );
        const dataOffset = header.numBytesInHeader ||
            (256 + header.numSignals * 256);
        const channelData = EDFParser._parseDataRecords(
            view, dataOffset, header, signals, arrayBuffer
        );

        return {
            header,
            signals,
            channels: channelData,
        };
    }

    static _hexDump(view, offset, length) {
        const bytes = [];
        for (let i = 0; i < Math.min(length, view.byteLength - offset); i++) {
            bytes.push(
                view.getUint8(offset + i).toString(16).padStart(2, '0')
            );
        }
        return bytes.join(' ');
    }

    static _parseHeader(view) {
        if (view.byteLength < 256) return null;

        const version = EDFParser._readASCII(view, 0, 8).trim();

        const firstByte = view.getUint8(0);
        if (firstByte !== 0x30 && firstByte !== 0xFF && version.length === 0) {
            console.error(
                '[EDFParser] Header validation failed:',
                `firstByte=0x${firstByte.toString(16)}, ` +
                `version="${version}", ` +
                `hex=${EDFParser._hexDump(view, 0, 8)}`
            );
            return null;
        }

        const numBytesInHeader = parseInt(
            EDFParser._readASCII(view, 184, 8)
        );
        const numDataRecords = parseInt(
            EDFParser._readASCII(view, 236, 8)
        );
        const durationPerRecord = parseFloat(
            EDFParser._readASCII(view, 244, 8)
        );
        const numSignals = parseInt(
            EDFParser._readASCII(view, 252, 4)
        );

        if (isNaN(numDataRecords) || isNaN(durationPerRecord) ||
            isNaN(numSignals)) {
            console.error(
                '[EDFParser] Header numeric fields invalid:',
                `numDataRecords=${numDataRecords}, ` +
                `durationPerRecord=${durationPerRecord}, ` +
                `numSignals=${numSignals}, ` +
                `raw184="${EDFParser._readASCII(view, 184, 8)}", ` +
                `raw236="${EDFParser._readASCII(view, 236, 8)}", ` +
                `raw244="${EDFParser._readASCII(view, 244, 8)}", ` +
                `raw252="${EDFParser._readASCII(view, 252, 4)}"`
            );
            return null;
        }
        if (numSignals <= 0 || numSignals > 1000) {
            console.error(
                '[EDFParser] Invalid numSignals:', numSignals
            );
            return null;
        }
        if (durationPerRecord <= 0) {
            console.error(
                '[EDFParser] Invalid durationPerRecord:', durationPerRecord
            );
            return null;
        }

        return {
            version,
            patientId: EDFParser._readASCII(view, 8, 80).trim(),
            recordingId: EDFParser._readASCII(view, 88, 80).trim(),
            startDate: EDFParser._readASCII(view, 168, 8).trim(),
            startTime: EDFParser._readASCII(view, 176, 8).trim(),
            numBytesInHeader: isNaN(numBytesInHeader) ? 0 : numBytesInHeader,
            numDataRecords,
            durationPerRecord,
            numSignals,
            totalDuration: numDataRecords * durationPerRecord,
        };
    }

    static _parseSignalsHeader(view, offset, numSignals) {
        const signals = [];

        const ns = numSignals;
        const labels = EDFParser._readASCIIArray(
            view, offset, 16, ns
        );
        const transducerTypes = EDFParser._readASCIIArray(
            view, offset + ns * 16, 80, ns
        );
        const physicalDimensions = EDFParser._readASCIIArray(
            view, offset + ns * 96, 8, ns
        );
        const physicalMins = EDFParser._readFloatArray(
            view, offset + ns * 104, 8, ns
        );
        const physicalMaxs = EDFParser._readFloatArray(
            view, offset + ns * 112, 8, ns
        );
        const digitalMins = EDFParser._readIntArray(
            view, offset + ns * 120, 8, ns
        );
        const digitalMaxs = EDFParser._readIntArray(
            view, offset + ns * 128, 8, ns
        );
        const prefiltering = EDFParser._readASCIIArray(
            view, offset + ns * 136, 80, ns
        );
        const samplesPerRecord = EDFParser._readIntArray(
            view, offset + ns * 216, 8, ns
        );

        for (let i = 0; i < ns; i++) {
            signals.push({
                label: labels[i].trim().replace(/\s+/g, ' '),
                transducerType: transducerTypes[i].trim(),
                physicalDimension: physicalDimensions[i].trim(),
                physicalMin: physicalMins[i],
                physicalMax: physicalMaxs[i],
                digitalMin: digitalMins[i],
                digitalMax: digitalMaxs[i],
                prefiltering: prefiltering[i].trim(),
                samplesPerRecord: samplesPerRecord[i],
            });
        }

        return signals;
    }

    static _parseDataRecords(view, offset, header, signals, arrayBuffer) {
        const channels = [];
        const bytesPerSample = 2;
        let totalSamplesPerRecord = 0;
        for (let s = 0; s < signals.length; s++) {
            totalSamplesPerRecord += signals[s].samplesPerRecord;
        }

        const recordSize = totalSamplesPerRecord * bytesPerSample;
        const expectedSize = offset + recordSize * header.numDataRecords;
        if (expectedSize > arrayBuffer.byteLength) {
            const actualRecords = Math.floor(
                (arrayBuffer.byteLength - offset) / recordSize
            );
            if (actualRecords <= 0) {
                throw new Error(
                    `File truncated: expected ${expectedSize} bytes, ` +
                    `got ${arrayBuffer.byteLength}`
                );
            }
            header.numDataRecords = actualRecords;
            header.totalDuration = actualRecords * header.durationPerRecord;
        }

        for (let ch = 0; ch < signals.length; ch++) {
            const sig = signals[ch];
            if (sig.samplesPerRecord <= 0) {
                channels.push({
                    name: sig.label || `Channel_${ch}`,
                    data: new Float32Array(0),
                    sfreq: 0,
                    physicalMin: sig.physicalMin,
                    physicalMax: sig.physicalMax,
                });
                continue;
            }

            const totalSamples = header.numDataRecords * sig.samplesPerRecord;
            const data = new Float32Array(totalSamples);

            const digitalRange = sig.digitalMax - sig.digitalMin;
            const physicalRange = sig.physicalMax - sig.physicalMin;
            const scale = digitalRange !== 0
                ? physicalRange / digitalRange : 1;
            const offsetVal = sig.physicalMin - sig.digitalMin * scale;

            let sampleIndex = 0;

            let channelOffset = 0;
            for (let prev = 0; prev < ch; prev++) {
                channelOffset +=
                    signals[prev].samplesPerRecord * bytesPerSample;
            }

            for (let rec = 0; rec < header.numDataRecords; rec++) {
                const recordStart =
                    offset + rec * recordSize + channelOffset;

                for (let s = 0; s < sig.samplesPerRecord; s++) {
                    const bytePos = recordStart + s * bytesPerSample;
                    const raw = view.getInt16(bytePos, true);
                    data[sampleIndex++] = raw * scale + offsetVal;
                }
            }

            channels.push({
                name: sig.label || `Channel_${ch}`,
                data: data,
                sfreq: sig.samplesPerRecord / header.durationPerRecord,
                physicalMin: sig.physicalMin,
                physicalMax: sig.physicalMax,
            });
        }

        return channels;
    }

    static _readASCII(view, offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            const code = view.getUint8(offset + i);
            if (code === 0) break;
            if (code >= 32 && code <= 126) {
                str += String.fromCharCode(code);
            }
        }
        return str;
    }

    static _readASCIIArray(view, offset, fieldSize, count) {
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(
                EDFParser._readASCII(view, offset + i * fieldSize, fieldSize)
            );
        }
        return result;
    }

    static _readFloatArray(view, offset, fieldSize, count) {
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(
                parseFloat(
                    EDFParser._readASCII(
                        view, offset + i * fieldSize, fieldSize
                    )
                )
            );
        }
        return result;
    }

    static _readIntArray(view, offset, fieldSize, count) {
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(
                parseInt(
                    EDFParser._readASCII(
                        view, offset + i * fieldSize, fieldSize
                    )
                )
            );
        }
        return result;
    }

    static computeBipolar(channels) {
        const parsed = [];
        for (const ch of channels) {
            const match =
                ch.name.match(/^POL\s*([A-Za-z]+)(\d+)/i) ||
                ch.name.match(/^EEG\s+([A-Za-z]+)\s+(\d+)-/i) ||
                ch.name.match(/^EEG\s*([A-Za-z]+)(\d+)-/i) ||
                ch.name.match(/^([A-Za-z]+)(\d+)/);
            if (match) {
                parsed.push({
                    prefix: match[1].toUpperCase(),
                    number: parseInt(match[2]),
                    channel: ch,
                });
            }
        }

        parsed.sort((a, b) => {
            if (a.prefix !== b.prefix) {
                return a.prefix.localeCompare(b.prefix);
            }
            return a.number - b.number;
        });

        const bipolar = [];
        let i = 0;

        while (i < parsed.length) {
            if (i + 1 < parsed.length &&
                parsed[i].prefix === parsed[i + 1].prefix &&
                parsed[i + 1].number === parsed[i].number + 1) {

                const ch1 = parsed[i].channel;
                const ch2 = parsed[i + 1].channel;
                const len = Math.min(ch1.data.length, ch2.data.length);
                const data = new Float32Array(len);
                for (let j = 0; j < len; j++) {
                    data[j] = ch1.data[j] - ch2.data[j];
                }

                bipolar.push({
                    // 保持原始通道名称，用 & 连接
                    name: `${ch1.name} & ${ch2.name}`,
                    data: data,
                    sfreq: ch1.sfreq,
                    physicalMin: ch1.physicalMin - ch2.physicalMax,
                    physicalMax: ch1.physicalMax - ch2.physicalMin,
                    type: 'bipolar',
                    ch1: ch1.name,
                    ch2: ch2.name,
                });

                i++;
            } else {
                i++;
            }
        }

        return bipolar;
    }

    static getChannelGroups(channels) {
        const groups = {};
        for (const ch of channels) {
            const match = ch.name.match(/^([A-Za-z]+)/);
            if (match) {
                const prefix = match[1].toUpperCase();
                if (!groups[prefix]) groups[prefix] = [];
                groups[prefix].push(ch.name);
            }
        }
        return groups;
    }
}

window.EDFParser = EDFParser;
