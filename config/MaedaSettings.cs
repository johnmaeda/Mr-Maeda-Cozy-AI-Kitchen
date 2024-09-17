using System;
using System.IO;
using System.Text.Json;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.DotNet.Interactive;

public class MaedaSettings
{
    private IConfigurationRoot configuration;
    private readonly string configFilePath;
    private readonly bool isNotebook;

    // Constructor to initialize with a custom filename and isNotebook flag
    public MaedaSettings(string filename, bool isNotebookEnv = true)
    {
        configFilePath = filename;
        isNotebook = isNotebookEnv;

        var builder = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile(configFilePath, optional: false, reloadOnChange: true);
        configuration = builder.Build();
    } 

    // Generalized method for querying and writing settings
    public async Task<string> QueryAndWriteSetting(string key, string prompt, bool isPassword = false)
    {
        // Get current setting if it exists
        var settings = LoadConfigFile();
        if (settings.TryGetValue(key, out var currentValue) && !string.IsNullOrWhiteSpace(currentValue))
        {
            return currentValue;
        }

        // Prompt user for input
        string newValue = isPassword ? await AskUserPassword(prompt) : await AskUserInput(prompt);

        // Write the new value to the settings file
        await WriteKeyValuePair(key, newValue);
        return newValue;
    }

    // Read settings values
    public (bool useAzureOpenAI, string model, string azureEndpoint, string apiKey, string orgId) LoadSettings()
    {
        bool useAzureOpenAI = configuration["type"] == "azure";
        string model = configuration["model"];
        string azureEndpoint = configuration["endpoint"];
        string apiKey = configuration["apikey"];
        string orgId = configuration["org"];

        return (useAzureOpenAI, model, azureEndpoint, apiKey, orgId);
    }

    // Read a single string from the configuration
    public string ReadString(string key)
    {
        return configuration[key] ?? string.Empty;
    }

    // Write a key-value pair to the settings file
    public async Task WriteKeyValuePair(string key, string value)
    {
        var settings = LoadConfigFile();
        settings[key] = value;
        await SaveConfigFile(settings);
    }

    // Prompt user for input with fallback
    public async Task<string> AskUserInput(string prompt)
    {
        if (isNotebook)
        {
            return await InteractiveKernel.GetInputAsync(prompt);
        }
        else
        {
            Console.WriteLine(prompt);
            return Console.ReadLine();
        }
    }

    // Prompt user for password input with fallback
    public async Task<string> AskUserPassword(string prompt)
    {
        if (isNotebook)
        {
            var password = await InteractiveKernel.GetPasswordAsync(prompt);
            return password.GetClearTextPassword();
        }
        else
        {
            Console.WriteLine(prompt);
            return Console.ReadLine();  // In a real console app, you would use a secure method to read passwords.
        }
    }

    // Example: Prompt for Azure Endpoint using the abstracted method
    public async Task<string> AskAzureEndpoint()
    {
        return await QueryAndWriteSetting("endpoint", "Please enter your Azure OpenAI endpoint");
    }

    // Example: Prompt for API Key using the abstracted method
    public async Task<string> AskApiKey()
    {
        return await QueryAndWriteSetting("apikey", "Please enter your API key", isPassword: true);
    }

    // Utility: Load config file as a dictionary
    private Dictionary<string, string> LoadConfigFile()
    {
        if (!File.Exists(configFilePath))
        {
            Console.WriteLine("Configuration not found: " + configFilePath);
            throw new Exception("Configuration not found.");
        }

        var configData = File.ReadAllText(configFilePath);
        return JsonSerializer.Deserialize<Dictionary<string, string>>(configData);
    }

    // Utility: Save config file
    private async Task SaveConfigFile(Dictionary<string, string> settings)
    {
        var options = new JsonSerializerOptions { WriteIndented = true };
        var json = JsonSerializer.Serialize(settings, options);
        await File.WriteAllTextAsync(configFilePath, json);
    }
}
