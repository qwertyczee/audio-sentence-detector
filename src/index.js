const { Readable } = require('stream');
const wav = require('wav-decoder');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class AudioSentenceDetector {
    constructor(options = {}) {
        this.options = {
            minSilenceDuration: options.minSilenceDuration || 0.5,      // seconds
            silenceThreshold: options.silenceThreshold || 0.01,         // amplitude (0-1)
            minSentenceLength: options.minSentenceLength || 1,          // seconds
            maxSentenceLength: options.maxSentenceLength || 15,         // seconds
            windowSize: options.windowSize || 2048,                     // samples
            idealSentenceLength: options.idealSentenceLength || 5,      // seconds
            idealSilenceDuration: options.idealSilenceDuration || 0.8,  // seconds

            fundamentalFreqMin: options.fundamentalFreqMin || 85,       // Minimum fundamental frequency of the voice
            fundamentalFreqMax: options.fundamentalFreqMax || 255,      // Maximum fundamental frequency of the voice
            formantFreqRanges: [                                        // Formant frequencies for human voice
                [270, 730],    // F1
                [840, 2290],   // F2
                [1690, 3010]   // F3
            ],
            // Parametry pro detekci řeči
            voiceActivityThreshold: options.voiceActivityThreshold || 0.4,
            minVoiceActivityDuration: options.minVoiceActivityDuration || 0.1,
            energySmoothing: options.energySmoothing || 0.95,
            formantEmphasis: options.formantEmphasis || 0.7,
            zeroCrossingRateThreshold: options.zeroCrossingRateThreshold || 0.3

        };
        this.debug = options.debug || false;
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
        const real = new Float32Array(n);
        const imag = new Float32Array(n);
        
        // Copying data and applying the Hamming window
        for (let i = 0; i < n; i++) {
            const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
            real[i] = buffer[i] * window;
            imag[i] = 0;
        }

        // In-place FFT
        this.fft(real, imag);
        
        // Calculation of magnitudes
        const magnitudes = new Float32Array(n / 2);
        for (let i = 0; i < n / 2; i++) {
            magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        }
        
        return magnitudes;
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

    isHumanVoice(buffer, sampleRate) {
        const magnitudes = this.performFFT(buffer);
        const freqResolution = sampleRate / buffer.length;
        
        let voiceBandEnergy = 0;
        let totalEnergy = 0;
        
        for (let i = 0; i < magnitudes.length; i++) {
            const frequency = i * freqResolution;
            const magnitude = magnitudes[i];
            
            totalEnergy += magnitude;
            
            if (frequency >= this.options.minVoiceFreq && frequency <= this.options.maxVoiceFreq) {
                voiceBandEnergy += magnitude;
            }
        }
        
        const voiceRatio = voiceBandEnergy / totalEnergy;
        return voiceRatio > this.options.voiceThreshold;
    }

    bufferToStream(buffer) {
        const stream = new Readable();
        stream.push(buffer);
        stream.push(null);
        return stream;
    }

    async detect(buffer) {
        const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.wav`);

        try {
            await new Promise((resolve, reject) => {
                const inputStream = this.bufferToStream(buffer);
        
                ffmpeg(inputStream)
                    .toFormat('wav')
                    .on('error', (err) => {
                        reject(new Error(`Error during conversion: ${err.message}`));
                    })
                    .on('end', resolve)
                    .save(tempFilePath);
            });

            console.log("converted")
            
            const wavBuffer = await fs.readFile(tempFilePath);
            const result = await this.detectSentences(wavBuffer);
            
            return result;  
        } catch (error) {
            throw new Error(`Error processing audio buffer: ${error.message}`);
        } finally {
            try {
                await fs.unlink(tempFilePath);
            } catch (cleanupError) {
                console.warn(`Could not delete temp file ${tempFilePath}:`, cleanupError);
            }
        }
    }

    async detectSentences(buffer) {
        const result = await wav.decode(buffer);
        
        const audioData = this.convertToMono(result.channelData);
        const sampleRate = result.sampleRate;
        
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

        return sentences;
    }

    convertToMono(channelData) {
        if (channelData.length === 1) return channelData[0];
        
        const monoData = new Float32Array(channelData[0].length);
        for (let i = 0; i < monoData.length; i++) {
            monoData[i] = channelData.reduce((sum, channel) => sum + channel[i], 0) / channelData.length;
        }
        return monoData;
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

    calculateSentenceProbability(sentence, audioData, sampleRate, silentRegion) {
        // 1. Length Score (0-1)
        // Using a normalized Gaussian function for length scoring
        const lengthScore = Math.max(0, Math.min(1, Math.exp(
            -Math.pow(sentence.duration - this.options.idealSentenceLength, 2) / 
            (2 * Math.pow(this.options.idealSentenceLength / 2, 2))
        )));

        // 2. Silence Strength Score (0-1)
        // Linear interpolation with bounds checking
        const silenceStrengthScore = silentRegion ? 
            Math.max(0, Math.min(1, 1 - (silentRegion.avgRMS / this.options.silenceThreshold))) : 0.3;

        // 3. Silence Duration Score (0-1)
        // Smooth transition with sigmoid function
        const silenceDurationScore = silentRegion ? 
            Math.max(0, Math.min(1,
                1 / (1 + Math.exp(-5 * (silentRegion.duration / this.options.idealSilenceDuration - 0.5)))
            )) : 0.3;

        // 4. Voice Analysis Score (0-1)
        const windowSize = Math.floor(0.1 * sampleRate);
        const startSampleIndex = Math.floor(sentence.start * sampleRate);
        const endSampleIndex = Math.floor(sentence.end * sampleRate);

        // Analyze multiple windows for more robust voice detection
        const numWindows = 3;
        let startVoiceScore = 0;
        let endVoiceScore = 0;

        for (let i = 0; i < numWindows; i++) {
            // Analyze start of sentence
            const startOffset = i * (windowSize / 2);
            const startWindow = audioData.slice(
                startSampleIndex + startOffset,
                Math.min(startSampleIndex + startOffset + windowSize, endSampleIndex)
            );
            
            // Analyze end of sentence
            const endWindow = audioData.slice(
                Math.max(endSampleIndex - windowSize - startOffset, startSampleIndex),
                endSampleIndex - startOffset
            );

            if (startWindow.length > 0) {
                startVoiceScore += this.isVoiceSegment(startWindow, sampleRate) ? 1 : 0;
            }
            
            if (endWindow.length > 0) {
                endVoiceScore += this.isVoiceSegment(endWindow, sampleRate) ? 1 : 0;
            }
        }

        // Normalize voice scores
        startVoiceScore /= numWindows;
        endVoiceScore /= numWindows;

        // Calculate voice transition score
        const voiceTransitionScore = Math.max(0, Math.min(1,
            (startVoiceScore * 0.7 + (1 - endVoiceScore) * 0.3)
        ));

        // 5. Energy Contour Score (0-1)
        const energyContourScore = this.calculateEnergyContour(
            audioData.slice(startSampleIndex, endSampleIndex),
            sampleRate
        );

        // Final probability calculation with weighted components
        const weights = {
            length: 0.25,
            silenceStrength: 0.15,
            silenceDuration: 0.15,
            voiceTransition: 0.25,
            energyContour: 0.20
        };

        const probability = 
            lengthScore * weights.length +
            silenceStrengthScore * weights.silenceStrength +
            silenceDurationScore * weights.silenceDuration +
            voiceTransitionScore * weights.voiceTransition +
            energyContourScore * weights.energyContour;

        // Ensure final probability is between 0 and 1
        const normalizedProbability = Math.max(0, Math.min(1, probability));

        if (this.debug) {
            console.log('Sentence probability components:', {
                length: lengthScore,
                silenceStrength: silenceStrengthScore,
                silenceDuration: silenceDurationScore,
                voiceTransition: voiceTransitionScore,
                energyContour: energyContourScore,
                final: normalizedProbability
            });
        }

        return normalizedProbability;
    }

    calculateEnergyContour(segment, sampleRate) {
        const windowSize = Math.floor(0.05 * sampleRate); // 50ms windows
        const numWindows = Math.floor(segment.length / windowSize);
        const energies = [];

        // Calculate energy for each window
        for (let i = 0; i < numWindows; i++) {
            const start = i * windowSize;
            const end = start + windowSize;
            const window = segment.slice(start, end);
            
            const energy = window.reduce((sum, sample) => sum + sample * sample, 0) / window.length;
            energies.push(energy);
        }

        if (energies.length < 2) return 0.5;

        // Analyze energy contour
        let risesCount = 0;
        let fallsCount = 0;

        for (let i = 1; i < energies.length; i++) {
            if (energies[i] > energies[i-1] * 1.1) risesCount++;
            if (energies[i] < energies[i-1] * 0.9) fallsCount++;
        }

        // Natural speech typically has a mix of rises and falls
        const dynamicRatio = Math.min(risesCount, fallsCount) / Math.max(risesCount, fallsCount);
        return Math.max(0, Math.min(1, dynamicRatio));
    }

    findSentenceBoundaries(silentRegions, audioData, sampleRate) {
        const sentences = [];
        let lastEnd = 0;
        const totalDuration = audioData.length / sampleRate;

        for (let i = 0; i < silentRegions.length; i++) {
            const region = silentRegions[i];
            const sentenceDuration = region.start - lastEnd;

            if (sentenceDuration >= this.options.minSentenceLength && sentenceDuration <= this.options.maxSentenceLength) {
                const sentence = {
                index: sentences.length,
                start: lastEnd,
                end: region.start,
                duration: sentenceDuration
                };
                
                sentence.probability = this.calculateSentenceProbability(
                sentence, 
                audioData, 
                sampleRate, 
                region
                );

                sentences.push(sentence);
            } else if (sentenceDuration > this.options.maxSentenceLength) {
                const numParts = Math.ceil(sentenceDuration / this.options.maxSentenceLength);
                const partDuration = sentenceDuration / numParts;
                
                for (let j = 0; j < numParts; j++) {
                const sentence = {
                    index: sentences.length,
                    start: lastEnd + (j * partDuration),
                    end: lastEnd + ((j + 1) * partDuration),
                    duration: partDuration
                };

                sentence.probability = this.calculateSentenceProbability(
                    sentence,
                    audioData,
                    sampleRate,
                    j === numParts - 1 ? region : null
                );

                sentences.push(sentence);
                }
            }

            lastEnd = region.end;
        }

        // Handle the last segment if it exists
        if (lastEnd < totalDuration) {
            const remainingDuration = totalDuration - lastEnd;
            if (remainingDuration >= this.options.minSentenceLength) {
                const sentence = {
                    index: sentences.length,
                    start: lastEnd,
                    end: totalDuration,
                    duration: remainingDuration
                };

                sentence.probability = this.calculateSentenceProbability(
                    sentence,
                    audioData,
                    sampleRate,
                    null
                );

                sentences.push(sentence);
            }
        }

        return sentences;
    }
}

module.exports = AudioSentenceDetector;