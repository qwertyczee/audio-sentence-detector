# Audio Sentence Detector

An advanced audio sentence detection library that uses voice activity detection, silence analysis, and acoustic features to segment audio into sentences.

## Installation

```bash
npm install audio-sentence-detector
```

## Usage

```javascript
const AudioSentenceDetector = require('audio-sentence-detector');

// Create detector with custom options
const detector = new AudioSentenceDetector({
    minSilenceDuration: 0.5,
    silenceThreshold: 0.01
});

// Process audio buffer
const sentences = await detector.detect(audioBuffer);
```

## Configuration Options

The AudioSentenceDetector constructor accepts an options object with the following parameters:

### Basic Sentence Detection Options

| Option | Default | Description |
|--------|---------|-------------|
| `minSilenceDuration` | `0.5` | Minimum duration of silence (in seconds) to be considered a sentence boundary |
| `silenceThreshold` | `0.01` | RMS threshold below which audio is considered silence |
| `minSentenceLength` | `1` | Minimum length of a sentence in seconds |
| `maxSentenceLength` | `15` | Maximum length of a sentence in seconds |
| `windowSize` | `2048` | Size of the analysis window in samples |
| `idealSentenceLength` | `5` | Ideal length of a sentence in seconds (used for probability calculations) |
| `idealSilenceDuration` | `0.8` | Ideal duration of silence between sentences |
| `allowGaps` | `true` | Whether to allow gaps between sentences |
| `minSegmentLength` | `0` | Minimum length for merged segments |
| `alignToAudioBoundaries` | `false` | Whether to align sentences with audio file boundaries |

### Voice Detection Options

| Option | Default | Description |
|--------|---------|-------------|
| `fundamentalFreqMin` | `85` | Minimum fundamental frequency for voice detection (Hz) |
| `fundamentalFreqMax` | `255` | Maximum fundamental frequency for voice detection (Hz) |
| `voiceActivityThreshold` | `0.4` | Threshold for voice activity detection |
| `minVoiceActivityDuration` | `0.1` | Minimum duration of voice activity (seconds) |
| `energySmoothing` | `0.95` | Smoothing factor for energy calculations |
| `formantEmphasis` | `0.7` | Emphasis factor for formant detection |
| `zeroCrossingRateThreshold` | `0.3` | Threshold for zero-crossing rate in voice detection |

### Debug Option

| Option | Default | Description |
|--------|---------|-------------|
| `debug` | `false` | Enable debug logging |

## Return Value

The `detect()` method returns an array of sentence objects, each containing:

```javascript
{
    index: number,          // Index of the sentence
    start: number,          // Start time in seconds
    end: number,           // End time in seconds
    duration: number,      // Duration in seconds
    probability: number    // Confidence score (0-1)
}
```

## Example

```javascript
const AudioSentenceDetector = require('audio-sentence-detector');

// Create detector with custom settings
const detector = new AudioSentenceDetector({
    minSilenceDuration: 0.3,
    silenceThreshold: 0.02,
    minSentenceLength: 1.5,
    maxSentenceLength: 10,
    debug: true
});

// Process audio file
const fs = require('fs');
const audioBuffer = fs.readFileSync('speech.wav');

try {
    const sentences = await detector.detect(audioBuffer);
    console.log('Detected sentences:', sentences);
} catch (error) {
    console.error('Error processing audio:', error);
}
```

## License

MIT