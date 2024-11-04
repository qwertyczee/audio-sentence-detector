const AudioSentenceDetector = require('../src/index');
const fs = require('fs').promises;
const path = require('path');

describe('AudioSentenceDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new AudioSentenceDetector({
      minSilenceDuration: 0.5,
      silenceThreshold: 0.0085,
      minSentenceLength: 1,
      maxSentenceLength: 15
    });
  });

  test('should create instance with default options', () => {
    const defaultDetector = new AudioSentenceDetector();
    expect(defaultDetector.options).toBeDefined();
    expect(defaultDetector.options.minSilenceDuration).toBe(0.5);
    expect(defaultDetector.options.silenceThreshold).toBe(0.01);
  });

  test('should create instance with custom options', () => {
    expect(detector.options.minSilenceDuration).toBe(0.5);
    expect(detector.options.silenceThreshold).toBe(0.0085);
    expect(detector.options.minSentenceLength).toBe(1);
    expect(detector.options.maxSentenceLength).toBe(15);
  });

  test('should convert mono audio data correctly', () => {
    const monoData = [new Float32Array([1, 2, 3])];
    const result = detector.convertToMono(monoData);
    expect(result).toEqual(new Float32Array([1, 2, 3]));
  });

  test('should convert stereo audio data to mono correctly', () => {
    const stereoData = [
      new Float32Array([1, 2, 3]),
      new Float32Array([4, 5, 6])
    ];
    const result = detector.convertToMono(stereoData);
    expect(result).toEqual(new Float32Array([2.5, 3.5, 4.5]));
  });

  test('should calculate RMS level correctly', () => {
    const audioData = new Float32Array([1, -1, 1, -1]);
    const rms = detector.calculateRMSLevel(audioData, 0, 4);
    expect(rms).toBe(1);
  });
});