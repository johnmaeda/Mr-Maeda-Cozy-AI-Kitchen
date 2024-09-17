// Copyright (c) Microsoft. All rights reserved.
using System;
using Microsoft.Extensions.Configuration;
using System.IO;

// ReSharper disable InconsistentNaming
public static class Utils
{
    // Function used to wrap long lines of text
    public static void LoadEnvFile()
    {
        string filePath = "../config/.env";

        if (!File.Exists(filePath))
        {
            throw new FileNotFoundException("The .env file could not be found");
        }

        foreach (var line in File.ReadAllLines(filePath))
        {
            var parts = line.Split('=', StringSplitOptions.RemoveEmptyEntries);

            if (parts.Length != 2)
            {
                continue; // or handle the error in your preferred way
            }

            Environment.SetEnvironmentVariable(parts[0].Trim(), parts[1].Trim());
        }
    }

    public static string WordWrap(string text, int maxLineLength)
    {
        var result = new StringBuilder();
        int i;
        var last = 0;
        var space = new[] { ' ', '\r', '\n', '\t' };
        do
        {
            i = last + maxLineLength > text.Length
                ? text.Length
                : (text.LastIndexOfAny(new[] { ' ', ',', '.', '?', '!', ':', ';', '-', '\n', '\r', '\t' }, Math.Min(text.Length - 1, last + maxLineLength)) + 1);
            if (i <= last) i = Math.Min(last + maxLineLength, text.Length);
            result.AppendLine(text.Substring(last, i - last).Trim(space));
            last = i;
        } while (i < text.Length);

        return result.ToString();
    }

    public static string ReadFile(string filePath)
    {
        try
        {
            // Read all text from the file and return it
            return File.ReadAllText(filePath);
        }
        catch (Exception ex)
        {
            // Handle any exceptions (like file not found, no permissions, etc.)
            Console.WriteLine($"Error reading file: {ex.Message}");
            return null;
        }
    }

    public static string ObfuscateString(string input)
    {
        if (string.IsNullOrEmpty(input))
        {
            return input;
        }

        int halfLength = input.Length / 2;
        return input.Substring(0, halfLength) + "...";
    }
}
