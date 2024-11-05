declare module 'audio-sentence-detector' {
    interface AudioSentenceDetectorOptions {
        minSilenceDuration?: number;
        silenceThreshold?: number;
        minSentenceLength?: number;
        maxSentenceLength?: number;
        windowSize?: number;
        idealSentenceLength?: number;
        idealSilenceDuration?: number;
        fundamentalFreqMin?: number;
        fundamentalFreqMax?: number;
        voiceActivityThreshold?: number;
        minVoiceActivityDuration?: number;
        energySmoothing?: number;
        formantEmphasis?: number;
        zeroCrossingRateThreshold?: number;
        debug?: boolean;
    }
    
    interface SilentRegion {
        start: number;
        end: number;
        duration: number;
        avgRMS: number;
    }
    
    interface Sentence {
        index: number;
        start: number;
        end: number;
        duration: number;
        probability: number;
    }
    
    class AudioSentenceDetector {
        constructor(options?: AudioSentenceDetectorOptions);
        detect(buffer: Buffer): Promise<Sentence[]>;
        detectSentences(buffer: Buffer): Promise<Sentence[]>;
    }
    
    export = AudioSentenceDetector;
}
