using Microsoft.Extensions.Configuration;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Agents.OpenAI;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;
using Microsoft.SemanticKernel.Plugins.Core;
using System;
using System.Text.Json;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.ComponentModel;
using System.Net.Http;
using System.Net.Http.Headers;
using Microsoft.Extensions.DependencyInjection;
using System.Threading;
using OpenAI.Files;
using OpenAI.VectorStores;

#pragma warning disable SKEXP0110, SKEXP0001, SKEXP0050, CS8600, CS8604, OPENAI001

public class MaedaAgentManager
{
    private readonly OpenAIClientProvider _provider;
    private readonly Microsoft.SemanticKernel.Kernel _kernel;
    private Dictionary<string, OpenAIAssistantAgent> _agents = new Dictionary<string, OpenAIAssistantAgent>();
    // I want to hold onto the fileids and the vectorstoreid for each of the agents attached to a string key
    // so that I can delete them later
    private Dictionary<string, List<string>> _fileIds = new Dictionary<string, List<string>>();
    private Dictionary<string, string> _vectorStoreIds = new Dictionary<string, string>();
    public MaedaAgentManager(Microsoft.SemanticKernel.Kernel kernel, OpenAIClientProvider provider)
    {
        _kernel = kernel;
        _provider = provider;
    }

    public string ObfuscateString(string input)
    {
        if (string.IsNullOrEmpty(input))
        {
            return input;
        }

        int halfLength = input.Length / 2;
        return input.Substring(0, halfLength) + "...";
    }

    public async Task<string> CreateAgentWithFilesAsync(string name, string model, string description, string instructions, List<string> filePaths)
    {
        FileClient fileClient = _provider.Client.GetFileClient();
        VectorStoreClient vectorStoreClient = _provider.Client.GetVectorStoreClient();

        List<string> fileIds = new List<string>();

        foreach (string filePath in filePaths)
        {
            // Read the file bytes and convert to MemoryStream
            byte[] fileBytes = await System.IO.File.ReadAllBytesAsync(filePath);
            using (MemoryStream fileStream = new MemoryStream(fileBytes))
            {
                OpenAIFileInfo uploadFile = await fileClient.UploadFileAsync(
                    fileStream, // Pass the MemoryStream here
                    Path.GetFileName(filePath),
                    FileUploadPurpose.Assistants
                );

                // Collect the file ID
                fileIds.Add(uploadFile.Id);
            }
        }

        // Create a vector store with the uploaded file IDs
        VectorStore vectorStore = await vectorStoreClient.CreateVectorStoreAsync(
            new VectorStoreCreationOptions()
            {
                FileIds = fileIds.ToArray(),
                Metadata = { { "AssistantSampleMetadataKey", bool.TrueString.ToString() } }
            }
        );

        var agent = await OpenAIAssistantAgent.CreateAsync(
            _kernel,
            _provider,
            new(model)
            {
                Description = description,
                Instructions = instructions,
                Name = name,
                EnableFileSearch = fileIds.Any(),
                VectorStoreId = vectorStore.Id
            });

        _fileIds[agent.Id] = fileIds;
        _vectorStoreIds[agent.Id] = vectorStore.Id;
        _agents[agent.Id] = agent;
        return agent.Id;
    }

    // delete all agents created with the manager
    public async Task DeleteAllAgentsAsync()
    {
        foreach (var agent in _agents.Values)
        {
            Console.WriteLine($"Deleting agent with ID: {ObfuscateString(agent.Id)}");
            await agent.DeleteAsync();
        }
        _agents.Clear();
    }
    public async Task<string> CreatePlainAgent(string name, string model, string description, string instructions)
    {
        var agent = await OpenAIAssistantAgent.CreateAsync(
            _kernel,
            _provider,
            new(model)
            {
                Description = description,
                Instructions = instructions,
                Name = name
            });

        _agents[agent.Id] = agent;
        return agent.Id;
    }

    public async Task<string> DeleteAssociatedAgentFilesAndVectorStoreAsync(string agentId)
    {
        if (_agents.ContainsKey(agentId))
        {
            Console.WriteLine($"Deleting agent files associated with ID: {ObfuscateString(agentId)}");

            if (!_vectorStoreIds.ContainsKey(agentId) || !_fileIds.ContainsKey(agentId))
            {
                Console.WriteLine("No files or vector store associated with this agent");
                return agentId;
            }

            OpenAIAssistantAgent agent = _agents[agentId];
            FileClient fileClient = _provider.Client.GetFileClient();
            VectorStoreClient vectorStoreClient = _provider.Client.GetVectorStoreClient();

            // need to grab the specific array of file ids
            List<string> fileIds = _fileIds[agentId];            
            foreach (string fileId in fileIds)
            {
                Console.WriteLine($"Deleting file with ID: {ObfuscateString(fileId)}");
                await fileClient.DeleteFileAsync(fileId);
            }
            // get the vectorstoreid
            string vectorStoreId = _vectorStoreIds[agentId];
            Console.WriteLine($"Deleting vector store with ID: {ObfuscateString(vectorStoreId)}");
            await vectorStoreClient.DeleteVectorStoreAsync(vectorStoreId);
        }
        return agentId;
    }
}
