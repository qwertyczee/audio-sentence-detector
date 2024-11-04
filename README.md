# Audio Sentence Detector

A Node.js library for detecting sentence boundaries in audio files using silence detection. This library analyzes audio files to find natural breaks in speech based on silence patterns, making it useful for transcription, subtitling, and audio processing applications.

## Features

- Automatic sentence boundary detection based on silence
- Support for WAV files and automatic conversion from other formats using FFmpeg
- Configurable silence detection parameters
- Probability scoring for detected sentences
- TypeScript support

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
const fs = require('fs');

async function main() {
  // Create detector instance with custom options
  const detector = new AudioSentenceDetector({
    minSilenceDuration: 0.5,    // Minimum silence duration in seconds
    silenceThreshold: 0.0085,   // Amplitude threshold for silence detection
    minSentenceLength: 1,       // Minimum sentence length in seconds
    maxSentenceLength: 15,      // Maximum sentence length in seconds
    idealSentenceLength: 5,     // Ideal sentence length in seconds
    idealSilenceDuration: 0.5   // Ideal silence duration between sentences
  });

  try {
    // Read audio file
    const buffer = fs.readFileSync('audio.wav');
    
    // Process audio and detect sentences
    const sentences = await detector.processBuffer(buffer);
    
    // Use the detected sentences
    console.log(sentences);
    /*
    Output format:
    [
      {
        index: 0,
        start: 0.0,        // Start time in seconds
        end: 4.5,         // End time in seconds
        duration: 4.5,     // Duration in seconds
        probability: 0.85  // Confidence score (0-1)
      },
      ...
    ]
    */
  } catch (error) {
    console.error('Error:', error);
  }
}
```

## API Reference

### `AudioSentenceDetector`

#### Constructor Options

```typescript
{
  minSilenceDuration?: number;    // Minimum silence duration (seconds), default: 0.5
  silenceThreshold?: number;      // Silence amplitude threshold (0-1), default: 0.01
  minSentenceLength?: number;     // Minimum sentence length (seconds), default: 1
  maxSentenceLength?: number;     // Maximum sentence length (seconds), default: 15
  windowSize?: number;            // Analysis window size (samples), default: 2048
  idealSentenceLength?: number;   // Target sentence length (seconds), default: 5
  idealSilenceDuration?: number;  // Target silence duration (seconds), default: 0.8
  debug?: boolean;                // Enable debug logging, default: false
}
```

#### Methods

##### `async processBuffer(buffer: Buffer): Promise<Sentence[]>`

Process an audio buffer and detect sentences.

Returns an array of sentence objects with the following properties:
- `index`: Sequential index of the sentence
- `start`: Start time in seconds
- `end`: End time in seconds
- `duration`: Duration in seconds
- `probability`: Confidence score (0-1) for the sentence boundary

## How It Works

The library uses a multi-step process to detect sentence boundaries:

1. **Audio Processing**: Converts input audio to mono WAV format
2. **Silence Detection**: Identifies silent regions using RMS amplitude analysis
3. **Boundary Detection**: Determines sentence boundaries based on silence patterns
4. **Probability Scoring**: Scores each detected sentence based on multiple factors:
   - Sentence length compared to ideal length
   - Silence strength at boundaries
   - Silence duration
   - Energy distribution at start and end

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.