const AudioContext = require('web-audio-api').AudioContext;

class AudioSentenceDetector {
    constructor(options = {}) {
        this.options = {
            minSilenceDuration: options.minSilenceDuration || 0.5,
            silenceThreshold: options.silenceThreshold || 0.01,
            minSentenceLength: options.minSentenceLength || 1,
            maxSentenceLength: options.maxSentenceLength || 15,
            windowSize: options.windowSize || 2048,
            allowGaps: options.allowGaps !== undefined ? options.allowGaps : true,
            minSegmentLength: options.minSegmentLength || 0,
            alignToAudioBoundaries: options.alignToAudioBoundaries || false,

            fundamentalFreqMin: options.fundamentalFreqMin || 85,
            fundamentalFreqMax: options.fundamentalFreqMax || 255,
            formantFreqRanges: [
                [270, 730],
                [840, 2290],
                [1690, 3010]
            ],
            voiceActivityThreshold: options.voiceActivityThreshold || 0.4,
            minVoiceActivityDuration: options.minVoiceActivityDuration || 0.1,
            energySmoothing: options.energySmoothing || 0.95,
            formantEmphasis: options.formantEmphasis || 0.7,
            zeroCrossingRateThreshold: options.zeroCrossingRateThreshold || 0.3
        };
        this.debug = options.debug || false;
        this.fftBuffers = {
            real: null,
            imag: null,
            magnitudes: null,
            window: null
        };
        this.voiceActivityBuffer = new Float32Array(1024);
        this.memoizedFFT = new Map();
    }

    calculateZeroCrossingRate(buffer) {
        let crossings = 0;
        for (let i = 1; i < buffer.length; i++) {
            if ((buffer[i] >= 0 && buffer[i - 1] < 0) || 
                (buffer[i] < 0 && buffer[i - 1] >= 0)) {
                crossings++;
            }
        }
        return crossings / (buffer.length - 1);
    }

    calculateSpectralCentroid(magnitudes, sampleRate) {
        let weightedSum = 0;
        let sum = 0;
        const freqResolution = sampleRate / (magnitudes.length * 2);
        
        for (let i = 0; i < magnitudes.length; i++) {
            const frequency = i * freqResolution;
            weightedSum += frequency * magnitudes[i];
            sum += magnitudes[i];
        }
        
        return sum === 0 ? 0 : weightedSum / sum;
    }

    detectFormants(magnitudes, sampleRate) {
        const formantScores = this.options.formantFreqRanges.map(([min, max]) => {
            let energy = 0;
            const minBin = Math.floor(min / (sampleRate / magnitudes.length / 2));
            const maxBin = Math.ceil(max / (sampleRate / magnitudes.length / 2));
            
            for (let i = minBin; i <= maxBin && i < magnitudes.length; i++) {
                energy += magnitudes[i];
            }
            
            return energy;
        });
        
        const totalEnergy = magnitudes.reduce((sum, mag) => sum + mag, 0);
        return formantScores.map(score => score / totalEnergy);
    }

    isVoiceSegment(buffer, sampleRate) {
        // 1. Zero-crossing rate
        const zcr = this.calculateZeroCrossingRate(buffer);
        
        // 2. Spektrální analýza
        const magnitudes = this.performFFT(buffer);
        const spectralCentroid = this.calculateSpectralCentroid(magnitudes, sampleRate);
        
        // 3. Detekce formantů
        const formantScores = this.detectFormants(magnitudes, sampleRate);
        
        // 4. Energie v pásmech lidského hlasu
        const voiceBandEnergy = this.calculateVoiceBandEnergy(magnitudes, sampleRate);
        
        // 5. Výpočet pravděpodobnosti přítomnosti hlasu
        const zcrScore = zcr > 0.1 && zcr < this.options.zeroCrossingRateThreshold ? 1 : 0;
        const centroidScore = spectralCentroid > 100 && spectralCentroid < 3000 ? 1 : 0;
        const formantScore = formantScores.reduce((acc, score) => acc + (score > 0.1 ? 1 : 0), 0) / formantScores.length;
        const energyScore = voiceBandEnergy > this.options.voiceActivityThreshold ? 1 : 0;
        
        // Weighted average of all scores
        const weights = [0.3, 0.2, 0.3, 0.2]; // zcr, centroid, formanty, energie
        const finalScore = (
            zcrScore * weights[0] +
            centroidScore * weights[1] +
            formantScore * weights[2] +
            energyScore * weights[3]
        );
        
        if (this.debug) {
            console.log('Voice detection scores:', {
                zcr: zcrScore,
                centroid: centroidScore,
                formant: formantScore,
                energy: energyScore,
                final: finalScore
            });
        }
        
        return finalScore > 0.6; // Stricter threshold for voice detection
    }

    calculateVoiceBandEnergy(magnitudes, sampleRate) {
        const freqResolution = sampleRate / (magnitudes.length * 2);
        let voiceBandEnergy = 0;
        let totalEnergy = 0;
        
        for (let i = 0; i < magnitudes.length; i++) {
            const frequency = i * freqResolution;
            const magnitude = magnitudes[i];
            
            totalEnergy += magnitude;
            
            // Check if the frequency falls within the human voice range
            if (frequency >= this.options.fundamentalFreqMin && 
                frequency <= this.options.formantFreqRanges[2][1]) { // Up to the third formant
                
                // Weighting based on the importance of frequencies for the human voice
                let weight = 1.0;
                
                // Emphasize the fundamental frequency
                if (frequency >= this.options.fundamentalFreqMin && 
                    frequency <= this.options.fundamentalFreqMax) {
                    weight = 2.0;
                }
                
                // Highlighting formant areas
                for (const [min, max] of this.options.formantFreqRanges) {
                    if (frequency >= min && frequency <= max) {
                        weight = 1.5;
                        break;
                    }
                }
                
                voiceBandEnergy += magnitude * weight;
            }
        }
        
        return voiceBandEnergy / totalEnergy;
    }

    performFFT(buffer) {
        const n = buffer.length;
        
        if (!this.fftBuffers.real || this.fftBuffers.real.length !== n) {
            this.fftBuffers.real = new Float32Array(n);
            this.fftBuffers.imag = new Float32Array(n);
            this.fftBuffers.magnitudes = new Float32Array(n / 2);
            this.fftBuffers.window = new Float32Array(n);
            
            // Precompute window function
            for (let i = 0; i < n; i++) {
                this.fftBuffers.window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
            }
        }

        for (let i = 0; i < n; i++) {
            this.fftBuffers.real[i] = buffer[i] * this.fftBuffers.window[i];
            this.fftBuffers.imag[i] = 0;
        }

        // In-place FFT
        this.fftIterative(this.fftBuffers.real, this.fftBuffers.imag);
        
        for (let i = 0; i < n / 2; i++) {
            this.fftBuffers.magnitudes[i] = Math.sqrt(
                this.fftBuffers.real[i] * this.fftBuffers.real[i] + 
                this.fftBuffers.imag[i] * this.fftBuffers.imag[i]
            );
        }
        
        return this.fftBuffers.magnitudes;
    }

    fftIterative(real, imag) {
        const n = real.length;
        
        // Bit reversal
        for (let i = 0; i < n; i++) {
            const j = this.reverseBits(i, Math.log2(n));
            if (j > i) {
                [real[i], real[j]] = [real[j], real[i]];
                [imag[i], imag[j]] = [imag[j], imag[i]];
            }
        }
        
        // Butterfly operations
        for (let size = 2; size <= n; size *= 2) {
            const halfSize = size / 2;
            const angle = -2 * Math.PI / size;
            
            for (let i = 0; i < n; i += size) {
                for (let j = 0; j < halfSize; j++) {
                    const tReal = real[i + j + halfSize] * Math.cos(angle * j) - 
                                imag[i + j + halfSize] * Math.sin(angle * j);
                    const tImag = real[i + j + halfSize] * Math.sin(angle * j) + 
                                imag[i + j + halfSize] * Math.cos(angle * j);
                    
                    real[i + j + halfSize] = real[i + j] - tReal;
                    imag[i + j + halfSize] = imag[i + j] - tImag;
                    real[i + j] += tReal;
                    imag[i + j] += tImag;
                }
            }
        }
    }

    reverseBits(x, bits) {
        let result = 0;
        for (let i = 0; i < bits; i++) {
            result = (result << 1) | (x & 1);
            x >>= 1;
        }
        return result;
    }

    fft(real, imag) {
        const n = real.length;
        if (n <= 1) return;

        const halfN = n / 2;
        const evenReal = new Float32Array(halfN);
        const evenImag = new Float32Array(halfN);
        const oddReal = new Float32Array(halfN);
        const oddImag = new Float32Array(halfN);

        for (let i = 0; i < halfN; i++) {
            evenReal[i] = real[i * 2];
            evenImag[i] = imag[i * 2];
            oddReal[i] = real[i * 2 + 1];
            oddImag[i] = imag[i * 2 + 1];
        }

        this.fft(evenReal, evenImag);
        this.fft(oddReal, oddImag);

        for (let k = 0; k < halfN; k++) {
            const theta = -2 * Math.PI * k / n;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);
            
            const tReal = oddReal[k] * cosTheta - oddImag[k] * sinTheta;
            const tImag = oddReal[k] * sinTheta + oddImag[k] * cosTheta;

            real[k] = evenReal[k] + tReal;
            imag[k] = evenImag[k] + tImag;
            real[k + halfN] = evenReal[k] - tReal;
            imag[k + halfN] = evenImag[k] - tImag;
        }
    }

    async detect(buffer) {
        try {
            const audioData = await this.getAudioData(buffer);
            const sentences = await this.detectSentences(audioData.channelData[0], audioData.sampleRate);
            return sentences;
        } catch (error) {
            throw new Error(`Error processing audio buffer: ${error.message}`);
        }
    }

    async getAudioData(buffer) {
        return await new Promise((resolve, reject) => {
            const audioContext = new AudioContext();
            audioContext.decodeAudioData(buffer, (audioBuffer) => {
                const channels = audioBuffer.numberOfChannels;
                const sampleRate = audioBuffer.sampleRate;
                const channelData = [];
    
                for (let i = 0; i < channels; i++) {
                    channelData.push(audioBuffer.getChannelData(i));
                }
        
                resolve({ channels, sampleRate, channelData });
            }, (err) => {
                reject(err);
            });
        });
    }

    async detectSentences(audioData, sampleRate) {
        if (this.debug) {
            console.log(`Audio loaded: ${audioData.length} samples, ${sampleRate}Hz`);
            console.log(`Audio duration: ${audioData.length / sampleRate} seconds`);
        }

        const silenceMarkers = this.detectSilentRegions(audioData, sampleRate);
        if (this.debug) {
            console.log(`Found ${silenceMarkers.length} silent regions`);
        }

        const sentences = this.findSentenceBoundaries(silenceMarkers, audioData, sampleRate);
        if (this.debug) {
            console.log(`Detected ${sentences.length} sentences`);
        }

        if (this.options.alignToAudioBoundaries) {
            if (sentences.length === 0) {
                sentences.push({
                    index: 0,
                    start: 0,
                    end: audioData.length / sampleRate,
                    duration: audioData.length / sampleRate
                });
            } else {
                if (sentences[0].start !== 0) {
                    sentences[0].start = 0;
                }

                const lastSentence = sentences[sentences.length - 1];
                lastSentence.end = audioData.length / sampleRate;
                lastSentence.duration = lastSentence.end - lastSentence.start;
            }
        }

        return sentences;
    }

    detectSilentRegions(audioData, sampleRate) {
        const windowSize = this.options.windowSize;
        const silentRegions = [];
        let currentSilenceStart = null;
        let maxRMSInSilence = 0;
        let prevVoiceActivity = false;
        let voiceActivityBuffer = [];
        
        // Buffer for smoothing voice detection
        const smoothingBufferSize = Math.floor(0.1 * sampleRate / windowSize); // 100ms buffer
        
        for (let i = 0; i < audioData.length; i += windowSize) {
            const windowEnd = Math.min(i + windowSize, audioData.length);
            const window = audioData.slice(i, windowEnd);
            
            // Calculation of RMS energy
            const rms = Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
            
            // Voice detection in the current window
            const isVoice = this.isVoiceSegment(window, sampleRate);
            
            // Adding to the smoothing buffer
            voiceActivityBuffer.push(isVoice);
            if (voiceActivityBuffer.length > smoothingBufferSize) {
                voiceActivityBuffer.shift();
            }
            
            // Smoothed voice detection
            const voiceActivityRatio = voiceActivityBuffer.filter(v => v).length / voiceActivityBuffer.length;
            const isSmoothedVoice = voiceActivityRatio > 0.6;
            
            if (this.debug && i % (windowSize * 100) === 0) {
                console.log(`Position ${(i / sampleRate).toFixed(4)}s, RMS: ${rms.toFixed(4)}, Voice: ${isSmoothedVoice}`);
            }

            // Detection of silence or absence of voice
            if (!isSmoothedVoice || rms < this.options.silenceThreshold) {
                if (currentSilenceStart === null) {
                    currentSilenceStart = i;
                    maxRMSInSilence = rms;
                } else {
                    maxRMSInSilence = Math.max(maxRMSInSilence, rms);
                }
            } else if (currentSilenceStart !== null) {
                const silenceDuration = (i - currentSilenceStart) / sampleRate;
                if (silenceDuration >= this.options.minSilenceDuration) {
                    silentRegions.push({
                        start: currentSilenceStart / sampleRate,
                        end: i / sampleRate,
                        duration: silenceDuration,
                        avgRMS: maxRMSInSilence
                    });
                }
                currentSilenceStart = null;
                maxRMSInSilence = 0;
            }
            
            prevVoiceActivity = isSmoothedVoice;
        }
        
        // Processing the last region
        if (currentSilenceStart !== null) {
            const silenceDuration = (audioData.length - currentSilenceStart) / sampleRate;
            if (silenceDuration >= this.options.minSilenceDuration) {
                silentRegions.push({
                    start: currentSilenceStart / sampleRate,
                    end: audioData.length / sampleRate,
                    duration: silenceDuration,
                    avgRMS: maxRMSInSilence
                });
            }
        }

        return this.mergeCloseRegions(silentRegions);
    }

    mergeCloseRegions(regions) {
        if (regions.length < 2) return regions;
        
        const mergedRegions = [];
        let currentRegion = regions[0];
        
        for (let i = 1; i < regions.length; i++) {
            const nextRegion = regions[i];
            const gap = nextRegion.start - currentRegion.end;
            
            // If the gap between regions is less than 0.3s, merge them.
            if (gap < 0.3) {
                currentRegion = {
                    start: currentRegion.start,
                    end: nextRegion.end,
                    duration: nextRegion.end - currentRegion.start,
                    avgRMS: (currentRegion.avgRMS + nextRegion.avgRMS) / 2
                };
            } else {
                mergedRegions.push(currentRegion);
                currentRegion = nextRegion;
            }
        }
        
        mergedRegions.push(currentRegion);
        return mergedRegions;
    }

    findSentenceBoundaries(silentRegions, audioData, sampleRate) {
        let sentences = [];
        let lastEnd = 0;
        const totalDuration = audioData.length / sampleRate;

        for (let i = 0; i < silentRegions.length; i++) {
            const region = silentRegions[i];
            const sentenceDuration = region.start - lastEnd;

            if (sentenceDuration >= this.options.minSentenceLength && 
                sentenceDuration <= this.options.maxSentenceLength) {
                let segmentEnd = region.start;
                
                if (!this.options.allowGaps && i < silentRegions.length - 1) {
                    const gapMiddle = (region.end + silentRegions[i + 1].start) / 2;
                    segmentEnd = gapMiddle;
                }

                sentences.push({
                    index: sentences.length,
                    start: lastEnd,
                    end: segmentEnd,
                    duration: segmentEnd - lastEnd
                });
            } else if (sentenceDuration > this.options.maxSentenceLength) {
                const numParts = Math.ceil(sentenceDuration / this.options.maxSentenceLength);
                const partDuration = sentenceDuration / numParts;
                
                for (let j = 0; j < numParts; j++) {
                    let partEnd = lastEnd + ((j + 1) * partDuration);
                    
                    if (j === numParts - 1) {
                        if (!this.options.allowGaps && i < silentRegions.length - 1) {
                            partEnd = (region.end + silentRegions[i + 1].start) / 2;
                        } else {
                            partEnd = region.start;
                        }
                    }

                    sentences.push({
                        index: sentences.length,
                        start: lastEnd + (j * partDuration),
                        end: partEnd,
                        duration: partEnd - (lastEnd + (j * partDuration))
                    });
                }
            }

            lastEnd = this.options.allowGaps ? region.end : (
                i < silentRegions.length - 1 ? 
                (region.end + silentRegions[i + 1].start) / 2 : 
                region.end
            );
        }

        if (lastEnd < totalDuration) {
            const remainingDuration = totalDuration - lastEnd;
            if (remainingDuration >= this.options.minSentenceLength) {
                sentences.push({
                    index: sentences.length,
                    start: lastEnd,
                    end: totalDuration,
                    duration: remainingDuration
                });
            }
        }

        if (this.options.minSegmentLength > 0) {
            sentences = this.mergeShortSegments(sentences);
        }

        return sentences;
    }

    mergeShortSegments(sentences) {
        if (sentences.length <= 1) return sentences;

        const mergedSegments = [];
        let currentSegment = sentences[0];
        let segmentsToMerge = [];

        for (let i = 0; i < sentences.length; i++) {
            const segment = sentences[i];
            
            if (segmentsToMerge.length === 0) {
                segmentsToMerge.push(segment);
                continue;
            }

            const currentDuration = segmentsToMerge.reduce((sum, seg) => sum + seg.duration, 0);
            
            if (currentDuration + segment.duration <= this.options.minSegmentLength) {
                // Přidáme segment do skupiny pro spojení
                segmentsToMerge.push(segment);
            } else {
                // Pokud máme nějaké segmenty ke spojení
                if (segmentsToMerge.length > 0) {
                    if (currentDuration >= this.options.minSegmentLength) {
                        // Současná skupina splňuje minimální délku
                        const mergedSegment = this.mergeSegmentGroup(segmentsToMerge);
                        mergedSegments.push(mergedSegment);
                        segmentsToMerge = [segment];
                    } else {
                        // Současná skupina je příliš krátká, spojíme ji s následujícím segmentem
                        segmentsToMerge.push(segment);
                        const mergedSegment = this.mergeSegmentGroup(segmentsToMerge);
                        mergedSegments.push(mergedSegment);
                        segmentsToMerge = [];
                    }
                } else {
                    mergedSegments.push(segment);
                }
            }
        }

        // Zpracování zbývajících segmentů
        if (segmentsToMerge.length > 0) {
            const mergedSegment = this.mergeSegmentGroup(segmentsToMerge);
            mergedSegments.push(mergedSegment);
        }

        return mergedSegments;
    }

    mergeSegmentGroup(segments) {
        if (segments.length === 0) return null;
        if (segments.length === 1) return segments[0];

        const start = segments[0].start;
        const end = segments[segments.length - 1].end;
        const duration = end - start;

        return {
            index: segments[0].index,
            start: start,
            end: end,
            duration: duration
        };
    }
}

module.exports = AudioSentenceDetector;