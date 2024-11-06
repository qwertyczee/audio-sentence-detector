declare module 'audio-sentence-detector' {
    export interface AudioSentenceDetectorOptions {
        // Basic Sentence Detection Options
        minSilenceDuration?: number;
        silenceThreshold?: number;
        minSentenceLength?: number;
        maxSentenceLength?: number;
        windowSize?: number;
        idealSentenceLength?: number;
        idealSilenceDuration?: number;
        allowGaps?: boolean;
        minSegmentLength?: number;
        alignToAudioBoundaries?: boolean;

        // Voice Detection Options
        fundamentalFreqMin?: number;
        fundamentalFreqMax?: number;
        formantFreqRanges?: [number, number][];
        voiceActivityThreshold?: number;
        minVoiceActivityDuration?: number;
        energySmoothing?: number;
        formantEmphasis?: number;
        zeroCrossingRateThreshold?: number;

        // Debug Option
        debug?: boolean;
    }

    export interface SilentRegion {
        start: number;
        end: number;
        duration: number;
        avgRMS: number;
    }

    export interface AudioData {
        channels: number;
        sampleRate: number;
        channelData: Float32Array[];
    }

    export interface SentenceSegment {
        index: number;
        start: number;
        end: number;
        duration: number;
        probability: number;
    }

    export default class AudioSentenceDetector {
        constructor(options?: AudioSentenceDetectorOptions);
        
        // Main detection method
        detect(buffer: Buffer | ArrayBuffer): Promise<SentenceSegment[]>;

        // Core analysis methods
        private getAudioData(buffer: Buffer | ArrayBuffer): Promise<AudioData>;
        private detectSentences(audioData: Float32Array, sampleRate: number): Promise<SentenceSegment[]>;
        private detectSilentRegions(audioData: Float32Array, sampleRate: number): SilentRegion[];
        private findSentenceBoundaries(silentRegions: SilentRegion[], audioData: Float32Array, sampleRate: number): SentenceSegment[];

        // Voice detection methods
        private isVoiceSegment(buffer: Float32Array, sampleRate: number): boolean;
        private calculateZeroCrossingRate(buffer: Float32Array): number;
        private calculateSpectralCentroid(magnitudes: Float32Array, sampleRate: number): number;
        private detectFormants(magnitudes: Float32Array, sampleRate: number): number[];
        private calculateVoiceBandEnergy(magnitudes: Float32Array, sampleRate: number): number;

        // FFT and signal processing
        private performFFT(buffer: Float32Array): Float32Array;
        private fft(real: Float32Array, imag: Float32Array): void;

        // Probability and analysis methods
        private calculateSentenceProbability(
            sentence: { start: number; end: number; duration: number },
            audioData: Float32Array,
            sampleRate: number,
            silentRegion: SilentRegion | null
        ): number;
        private calculateEnergyContour(segment: Float32Array, sampleRate: number): number;

        // Segment merging methods
        private mergeCloseRegions(regions: SilentRegion[]): SilentRegion[];
        private mergeShortSegments(sentences: SentenceSegment[]): SentenceSegment[];
        private mergeSegmentGroup(segments: SentenceSegment[]): SentenceSegment | null;
    }
}