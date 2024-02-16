using Microsoft.CognitiveServices.Speech;
using System;
using System.Text;
using System.Threading.Tasks;

public class SpeechRecognitionService
{
    private readonly string subscriptionKey;
    private readonly string serviceRegion;
    private readonly StringBuilder recognizedText = new StringBuilder();
    private readonly TaskCompletionSource<bool> stopRecognition = new TaskCompletionSource<bool>();

    public SpeechRecognitionService(string subscriptionKey, string serviceRegion)
    {
        this.subscriptionKey = subscriptionKey;
        this.serviceRegion = serviceRegion;
    }

    public async Task<string> RecognizeOnceAsync()
    {
        Console.WriteLine("Say something without pausing <up to 15 seconds> ...");
        var config = SpeechConfig.FromSubscription(subscriptionKey, serviceRegion);
        using var recognizer = new SpeechRecognizer(config);

        var result = await recognizer.RecognizeOnceAsync();
        if (result.Reason == ResultReason.RecognizedSpeech)
        {
            return result.Text;
        }
        else
        {
            return $"Recognition failed or not recognized. Reason: {result.Reason}";
        }
    }
    public async Task<string> StartContinuousRecognitionAsync()
    {
        Console.WriteLine("When you're done speaking, say 'stop transcription' to end the transcription.");

        var config = SpeechConfig.FromSubscription(subscriptionKey, serviceRegion);
        using var recognizer = new SpeechRecognizer(config);

        recognizer.Recognizing += (s, e) =>
        {
            Console.WriteLine($"Recognizing: {e.Result.Text}");
        };

        recognizer.Recognized += (s, e) =>
        {
            if (e.Result.Reason == ResultReason.RecognizedSpeech)
            {
                recognizedText.AppendLine(e.Result.Text);
                Console.WriteLine($"Recognized: {e.Result.Text}");

                if (e.Result.Text.Contains("stop transcription", StringComparison.OrdinalIgnoreCase))
                {
                    stopRecognition.SetResult(true);
                }
            }
        };

        recognizer.Canceled += (s, e) =>
        {
            Console.WriteLine($"Canceled: Reason={e.Reason}");
            stopRecognition.TrySetResult(false);
        };

        recognizer.SessionStopped += (s, e) =>
        {
            Console.WriteLine("Session stopped.");
            stopRecognition.TrySetResult(false);
        };

        await recognizer.StartContinuousRecognitionAsync();

        // Wait until the recognition is stopped
        await stopRecognition.Task;

        await recognizer.StopContinuousRecognitionAsync();

        return recognizedText.ToString();
    }
    public async Task SynthesizeSpeechAsync(string text, string voiceName = "en-US-JaneNeural")
    {
        var config = SpeechConfig.FromSubscription(subscriptionKey, serviceRegion);
        config.SpeechSynthesisVoiceName = voiceName;
        using var synthesizer = new SpeechSynthesizer(config);

        using var result = await synthesizer.SpeakTextAsync(text);
        if (result.Reason == ResultReason.SynthesizingAudioCompleted)
        {
         //   Console.WriteLine($"Spoke: \"{text}\"");
        }
        else if (result.Reason == ResultReason.Canceled)
        {
            var cancellation = SpeechSynthesisCancellationDetails.FromResult(result);
            Console.WriteLine($"Speech synthesis canceled: {cancellation.Reason}");

            if (cancellation.Reason == CancellationReason.Error)
            {
                Console.WriteLine($"ErrorCode={cancellation.ErrorCode}");
                Console.WriteLine($"ErrorDetails={cancellation.ErrorDetails}");
            }
        }
    }
}