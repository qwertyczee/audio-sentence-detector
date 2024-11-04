const { Readable } = require('stream');
const wav = require('node-wav');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

class AudioSentenceDetector {
  constructor(options = {}) {
    this.options = {
      minSilenceDuration: options.minSilenceDuration || 0.5,    // seconds
      silenceThreshold: options.silenceThreshold || 0.01,       // amplitude (0-1)
      minSentenceLength: options.minSentenceLength || 1,        // seconds
      maxSentenceLength: options.maxSentenceLength || 15,       // seconds
      windowSize: options.windowSize || 2048,                   // samples
      idealSentenceLength: options.idealSentenceLength || 5,    // seconds
      idealSilenceDuration: options.idealSilenceDuration || 0.8 // seconds
    };
    this.debug = options.debug || false;
  }

  bufferToStream(buffer) {
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    return stream;
  }

  async processBuffer(buffer) {
    try {
      // First try to process as WAV
      try {
        return await this.detectSentences(buffer);
      } catch (error) {
        // If WAV processing fails, continue with ffmpeg conversion
      }

      return new Promise((resolve, reject) => {
        const inputStream = this.bufferToStream(buffer);
        const chunks = [];

        ffmpeg(inputStream)
          .toFormat('wav')
          .on('error', (err) => {
            reject(new Error(`Error during conversion: ${err.message}`));
          })
          .on('end', async () => {
            try {
              const wavBuffer = Buffer.concat(chunks);
              const result = await this.detectSentences(wavBuffer);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          })
          .pipe()
          .on('data', chunk => chunks.push(chunk));
      });
    } catch (error) {
      throw new Error(`Error processing audio buffer: ${error.message}`);
    }
  }

  async detectSentences(buffer) {
    const result = wav.decode(buffer);
    
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

  calculateRMSLevel(audioData, startIdx, endIdx) {
    const samples = audioData.slice(startIdx, endIdx);
    return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  }

  detectSilentRegions(audioData, sampleRate) {
    const windowSize = this.options.windowSize;
    const silentRegions = [];
    let currentSilenceStart = null;
    let maxRMSInSilence = 0;
    
    for (let i = 0; i < audioData.length; i += windowSize) {
      const windowEnd = Math.min(i + windowSize, audioData.length);
      const window = audioData.slice(i, windowEnd);
      
      const rms = Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
      
      if (this.debug && i % (windowSize * 100) === 0) {
        console.log(`Position ${(i / sampleRate).toFixed(4)}s, RMS: ${rms.toFixed(4)}`);
      }

      if (rms < this.options.silenceThreshold) {
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
    }
    
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

    return silentRegions;
  }

  calculateSentenceProbability(sentence, audioData, sampleRate, silentRegion) {
    // 1. Sentence length - Gaussian curve around ideal length
    const lengthScore = Math.exp(
      -Math.pow(sentence.duration - this.options.idealSentenceLength, 2) / 
      (2 * Math.pow(this.options.idealSentenceLength / 2, 2))
    );

    // 2. Silence strength at the end of the sentence
    const silenceStrengthScore = silentRegion ? 
      (1 - silentRegion.avgRMS / this.options.silenceThreshold) : 0.3;

    // 3. Silent region length - exponential curve to ideal length
    const silenceDurationScore = silentRegion ? 
      Math.min(silentRegion.duration / this.options.idealSilenceDuration, 1) : 0.3;

    // 4. Energy at the start and end of the sentence
    const startSampleIndex = Math.floor(sentence.start * sampleRate);
    const endSampleIndex = Math.floor(sentence.end * sampleRate);
    const windowSize = Math.floor(0.1 * sampleRate); // 100ms window

    const startEnergy = this.calculateRMSLevel(
      audioData, 
      startSampleIndex, 
      Math.min(startSampleIndex + windowSize, endSampleIndex)
    );
    const endEnergy = this.calculateRMSLevel(
      audioData,
      Math.max(endSampleIndex - windowSize, startSampleIndex),
      endSampleIndex
    );

    const energyScore = (startEnergy > this.options.silenceThreshold * 2 && 
      endEnergy < this.options.silenceThreshold * 2) ? 1 : 0.5;

    // Weights for individual factors
    const weights = {
      length: 0.3,
      silenceStrength: 0.25,
      silenceDuration: 0.25,
      energy: 0.2
    };

    // Calculate total probability
    const probability = (
      lengthScore * weights.length +
      silenceStrengthScore * weights.silenceStrength +
      silenceDurationScore * weights.silenceDuration +
      energyScore * weights.energy
    );

    if (this.debug) {
      console.log(`Sentence probability scores:`, {
        length: lengthScore,
        silenceStrength: silenceStrengthScore,
        silenceDuration: silenceDurationScore,
        energy: energyScore,
        total: probability
      });
    }

    return probability;
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