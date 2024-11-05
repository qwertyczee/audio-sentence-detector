# Audio Sentence Detector

Advanced audio sentence detection using signal processing and voice activity detection. This library analyzes audio content to detect sentence boundaries based on silence detection, voice activity, and various acoustic features.

## Features

- Accurate sentence boundary detection in audio
- Voice activity detection
- Formant analysis
- Spectral processing
- Configurable parameters for different use cases
- TypeScript support
- Works with WAV files and raw audio buffers

## Installation

```bash
npm install audio-sentence-detector
```

## Requirements

- Node.js >= 14.0.0
- FFmpeg (automatically installed via ffmpeg-static)

## Usage

```javascript
const AudioSentenceDetector = require('audio-sentence-detector');
const fs = require('fs').promises;

async function detectSentences() {
  // Create detector instance with custom options
  const detector = new AudioSentenceDetector({
    minSilenceDuration: 0.5,
    silenceThreshold: 0.01,
    minSentenceLength: 1,
    maxSentenceLength: 15,
    debug: false
  });

  // Read audio file
  const audioBuffer = await fs.readFile('audio.wav');

  // Detect sentences
  const sentences = await detector.detect(audioBuffer);

  console.log('Detected sentences:', sentences);
}

detectSentences().catch(console.error);
```

## API

### Constructor Options

```typescript
interface AudioSentenceDetectorOptions {
  minSilenceDuration?: number;      // Minimum silence duration (seconds)
  silenceThreshold?: number;        // Silence amplitude threshold (0-1)
  minSentenceLength?: number;       // Minimum sentence length (seconds)
  maxSentenceLength?: number;       // Maximum sentence length (seconds)
  windowSize?: number;              // Analysis window size (samples)
  idealSentenceLength?: number;     // Ideal sentence length (seconds)
  idealSilenceDuration?: number;    // Ideal silence duration (seconds)
  fundamentalFreqMin?: number;      // Minimum fundamental frequency
  fundamentalFreqMax?: number;      // Maximum fundamental frequency
  voiceActivityThreshold?: number;  // Voice activity detection threshold
  debug?: boolean;                  // Enable debug logging
  // ... other options
}
```

### Methods

#### detect(buffer: Buffer): Promise<Sentence[]>
Analyzes audio buffer and returns detected sentences.

#### detectSentences(buffer: Buffer): Promise<Sentence[]>
Internal method for sentence detection from WAV buffer.

### Return Type

```typescript
interface Sentence {
  index: number;      // Sentence index
  start: number;      // Start time (seconds)
  end: number;        // End time (seconds)
  duration: number;   // Duration (seconds)
  probability: number; // Detection confidence (0-1)
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.