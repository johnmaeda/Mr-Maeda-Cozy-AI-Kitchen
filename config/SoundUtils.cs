using System;
using System.Threading.Tasks;
using NetCoreAudio;

// ReSharper disable InconsistentNaming
public static class SoundUtils {
    public static async Task PlaySound(string fileName)
    {
        var player = new Player();

        try
        {
            Console.WriteLine($"Playing {fileName}");
            await player.Play(fileName);

            // Wait for playback to finish
            while (player.Playing)
            {
                await Task.Delay(500); // Check every half-second if still playing
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"An error occurred: {ex.Message}");
        }
    }
}