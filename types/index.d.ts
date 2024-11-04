declare module 'audio-sentence-detector' {
    export interface AudioSentenceDetectorOptions {
        minSilenceDuration?: number;
        silenceThreshold?: number;
        minSentenceLength?: number;
        maxSentenceLength?: number;
        windowSize?: number;
        idealSentenceLength?: number;
        idealSilenceDuration?: number;
        debug?: boolean;
    }
    
    export interface SilentRegion {
        start: number;
        end: number;
        duration: number;
        avgRMS: number;
    }
    
    export interface Sentence {
        index: number;
        start: number;
        end: number;
        duration: number;
        probability: number;
    }
    
    export default class AudioSentenceDetector {
        constructor(options?: AudioSentenceDetectorOptions);
        processBuffer(buffer: Buffer): Promise<Sentence[]>;
        detectSentences(buffer: Buffer): Promise<Sentence[]>;
        private convertToMono(channelData: Float32Array[]): Float32Array;
        private calculateRMSLevel(audioData: Float32Array, startIdx: number, endIdx: number): number;
        private detectSilentRegions(audioData: Float32Array, sampleRate: number): SilentRegion[];
        private calculateSentenceProbability(
            sentence: Omit<Sentence, 'probability'>,
            audioData: Float32Array,
            sampleRate: number,
            silentRegion: SilentRegion | null
        ): number;
        private findSentenceBoundaries(
            silentRegions: SilentRegion[],
            audioData: Float32Array,
            sampleRate: number
        ): Sentence[];
    }
}