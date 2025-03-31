// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Player } from "./player.ts";
import { Recorder } from "./recorder.ts";
import "./style.css";
import { LowLevelRTClient, SessionUpdateMessage, Voice } from "rt-client";

let realtimeStreaming: LowLevelRTClient;
let audioRecorder: Recorder;
let audioPlayer: Player;

// Add at the top with other element declarations
const injectMonaLisaButton = document.getElementById('inject-mona-lisa') as HTMLButtonElement;

// Add these variables at the top with other declarations
let screenStream: MediaStream | null = null;
const startScreenCaptureButton = document.getElementById('start-screen-capture') as HTMLButtonElement;
const stopScreenCaptureButton = document.getElementById('stop-screen-capture') as HTMLButtonElement;
const analyzeScreenButton = document.getElementById('analyze-screen') as HTMLButtonElement;
const screenDisplay = document.getElementById('screen-display') as HTMLVideoElement;

// Add canvas for frame capture
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');

// Add after line 25
const DOWNSCALE_FACTOR = 0.1; // 10% of original size
const CHANGE_THRESHOLD = 0.15; // 15% difference threshold
const lastAnalyzedImageData = new WeakMap<CanvasRenderingContext2D, ImageData>();

 // Add these with other element declarations
const visionEndpointField = document.querySelector<HTMLInputElement>("#vision-endpoint")!;
const visionApiKeyField = document.querySelector<HTMLInputElement>("#vision-api-key")!;
const visionDeploymentField = document.querySelector<HTMLInputElement>("#vision-deployment")!;

// Add these functions before the event listeners section
async function startScreenCapture() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });
    screenDisplay.srcObject = screenStream;
    startScreenCaptureButton.disabled = true;
    stopScreenCaptureButton.disabled = false;
    analyzeScreenButton.disabled = false;  // Enable analyze button

    screenStream.getVideoTracks()[0].addEventListener('ended', () => {
      stopScreenCapture();
    });
  } catch (err) {
    console.error('Error starting screen capture:', err);
    makeNewTextBlock("[Error]: Failed to start screen capture");
  }
}

function stopScreenCapture() {
  if (autoAnalyzeToggle.checked) {
    autoAnalyzeToggle.checked = false;
    toggleAutoAnalyze(false);
  }
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
    screenDisplay.srcObject = null;
    startScreenCaptureButton.disabled = false;
    stopScreenCaptureButton.disabled = true;
    analyzeScreenButton.disabled = true;
  }
}


// Add the injection function
async function injectMonaLisaDescription() {
  if (!realtimeStreaming) {
    console.error("No active streaming session");
    return;
  }

  const monalisaDescription = {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "I'm looking at the Mona Lisa painting. It's a half-length portrait of a woman against a distant landscape. The subject is seated in what appears to be an armchair, with her arms folded, looking directly at the viewer with what's often described as an enigmatic smile. The atmospheric perspective creates a sense of depth, with a winding path and bridge visible in the bluish rocky landscape behind her. The woman wears Renaissance attire, and her hair falls onto her shoulders in gentle waves. The painting is known for its sfumato technique, creating a soft, hazy quality to the image."
        }
      ]
    }
  };
  try {
    await realtimeStreaming.send({
      type: "conversation.item.create" as const,
      item: {
        type: "message",
        role: "user", 
        content: [
          {
            type: "input_text",
            text: monalisaDescription.item.content[0].text
          }
        ]
      }
    });
    makeNewTextBlock("<< Injected Mona Lisa Description >>");
  } catch (error) {
    console.error("Failed to inject Mona Lisa description:", error);
    makeNewTextBlock("[Error]: Failed to inject Mona Lisa description");
  }
}

// Add the button event listener
injectMonaLisaButton.addEventListener("click", injectMonaLisaDescription);

async function start_realtime(endpoint: string, apiKey: string, deploymentOrModel: string) {
  if (isAzureOpenAI()) {
    realtimeStreaming = new LowLevelRTClient(new URL(endpoint), { key: apiKey }, { deployment: deploymentOrModel });
  } else {
    realtimeStreaming = new LowLevelRTClient({ key: apiKey }, { model: deploymentOrModel });
  }

  try {
    console.log("sending session config");
    await realtimeStreaming.send(createConfigMessage());
  } catch (error) {
    console.log(error);
    makeNewTextBlock("[Connection error]: Unable to send initial config message. Please check your endpoint and authentication details.");
    setFormInputState(InputState.ReadyToStart);
    return;
  }
  console.log("sent");
  await Promise.all([resetAudio(true), handleRealtimeMessages()]);
}

function createConfigMessage() : SessionUpdateMessage {

  let configMessage : SessionUpdateMessage = {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
      },
      input_audio_transcription: {
        model: "whisper-1"
      }
    }
  };

  const systemMessage = getSystemMessage();
  const temperature = getTemperature();
  const voice = getVoice();

  if (systemMessage) {
    configMessage.session.instructions = systemMessage;
  }
  if (!isNaN(temperature)) {
    configMessage.session.temperature = temperature;
  }
  if (voice) {
    configMessage.session.voice = voice;
  }

  return configMessage;
}

async function handleRealtimeMessages() {
  for await (const message of realtimeStreaming.messages()) {
    let consoleLog = "" + message.type;

    switch (message.type) {
      case "session.created":
        setFormInputState(InputState.ReadyToStop);
        makeNewTextBlock("<< Session Started >>");
        makeNewTextBlock();
        break;
      case "response.audio_transcript.delta":
        appendToTextBlock(message.delta);
        break;
      case "response.audio.delta":
        const binary = atob(message.delta);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const pcmData = new Int16Array(bytes.buffer);
        audioPlayer.play(pcmData);
        break;

      case "input_audio_buffer.speech_started":
        makeNewTextBlock("<< Speech Started >>");
        let textElements = formReceivedTextContainer.children;
        latestInputSpeechBlock = textElements[textElements.length - 1];
        makeNewTextBlock();
        audioPlayer.clear();
        break;
      case "conversation.item.input_audio_transcription.completed":
        latestInputSpeechBlock.textContent += " User: " + message.transcript;
        break;
      case "response.done":
        formReceivedTextContainer.appendChild(document.createElement("hr"));
        break;
      default:
        consoleLog = JSON.stringify(message, null, 2);
        break
    }
    if (consoleLog) {
      console.log(consoleLog);
    }
  }
  resetAudio(false);
}

/**
 * Basic audio handling
 */

let recordingActive: boolean = false;
let buffer: Uint8Array = new Uint8Array();

function combineArray(newData: Uint8Array) {
  const newBuffer = new Uint8Array(buffer.length + newData.length);
  newBuffer.set(buffer);
  newBuffer.set(newData, buffer.length);
  buffer = newBuffer;
}

function processAudioRecordingBuffer(data: Buffer) {
  const uint8Array = new Uint8Array(data);
  combineArray(uint8Array);
  if (buffer.length >= 4800) {
    const toSend = new Uint8Array(buffer.slice(0, 4800));
    buffer = new Uint8Array(buffer.slice(4800));
    const regularArray = String.fromCharCode(...toSend);
    const base64 = btoa(regularArray);
    if (recordingActive) {
      realtimeStreaming.send({
        type: "input_audio_buffer.append",
        audio: base64,
      });
    }
  }

}

async function resetAudio(startRecording: boolean) {
  recordingActive = false;
  if (audioRecorder) {
    audioRecorder.stop();
  }
  if (audioPlayer) {
    audioPlayer.clear();
  }
  audioRecorder = new Recorder(processAudioRecordingBuffer);
  audioPlayer = new Player();
  audioPlayer.init(24000);
  if (startRecording) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorder.start(stream);
    recordingActive = true;
  }
}

/**
 * UI and controls
 */

const formReceivedTextContainer = document.querySelector<HTMLDivElement>(
  "#received-text-container",
)!;
const formStartButton =
  document.querySelector<HTMLButtonElement>("#start-recording")!;
const formStopButton =
  document.querySelector<HTMLButtonElement>("#stop-recording")!;
const formClearAllButton =
  document.querySelector<HTMLButtonElement>("#clear-all")!;
const formEndpointField =
  document.querySelector<HTMLInputElement>("#endpoint")!;
const formAzureToggle =
  document.querySelector<HTMLInputElement>("#azure-toggle")!;
const formApiKeyField = document.querySelector<HTMLInputElement>("#api-key")!;
const formDeploymentOrModelField = document.querySelector<HTMLInputElement>("#deployment-or-model")!;
const formSessionInstructionsField =
  document.querySelector<HTMLTextAreaElement>("#session-instructions")!;
const formTemperatureField = document.querySelector<HTMLInputElement>("#temperature")!;
const formVoiceSelection = document.querySelector<HTMLInputElement>("#voice")!;

let latestInputSpeechBlock: Element;

enum InputState {
  Working,
  ReadyToStart,
  ReadyToStop,
}

function isAzureOpenAI(): boolean {
  return formAzureToggle.checked;
}

function guessIfIsAzureOpenAI() {
  const endpoint = (formEndpointField.value || "").trim();
  formAzureToggle.checked = endpoint.indexOf('azure') > -1;
}

function setFormInputState(state: InputState) {
  formEndpointField.disabled = state != InputState.ReadyToStart;
  formApiKeyField.disabled = state != InputState.ReadyToStart;
  formDeploymentOrModelField.disabled = state != InputState.ReadyToStart;
  formStartButton.disabled = state != InputState.ReadyToStart;
  formStopButton.disabled = state != InputState.ReadyToStop;
  formSessionInstructionsField.disabled = state != InputState.ReadyToStart;
  formAzureToggle.disabled = state != InputState.ReadyToStart;
  injectMonaLisaButton.disabled = state != InputState.ReadyToStop;
}

function getSystemMessage(): string {
  return formSessionInstructionsField.value || "";
}

function getTemperature(): number {
  return parseFloat(formTemperatureField.value);
}

function getVoice(): Voice {
  return formVoiceSelection.value as Voice;
}

// Add this helper function near the top with other utility functions
function scrollToBottom() {
  const container = document.querySelector("#received-text-container");
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// Modify the makeNewTextBlock function to include scrolling
function makeNewTextBlock(text?: string): HTMLDivElement {
  const block = document.createElement("div");
  if (text) {
    block.textContent = text;
  }
  formReceivedTextContainer.appendChild(block);
  scrollToBottom(); // Add this line to scroll after adding new content
  return block;
}

// Also modify appendToTextBlock to scroll after adding content
function appendToTextBlock(text: string) {
  const textElements = formReceivedTextContainer.children;
  const lastElement = textElements[textElements.length - 1];
  if (lastElement) {
    lastElement.textContent += text;
    scrollToBottom(); // Add this line to scroll after appending content
  }
}

formStartButton.addEventListener("click", async () => {
  setFormInputState(InputState.Working);

  const endpoint = formEndpointField.value.trim();
  const key = formApiKeyField.value.trim();
  const deploymentOrModel = formDeploymentOrModelField.value.trim();

  if (isAzureOpenAI() && !endpoint && !deploymentOrModel) {
    alert("Endpoint and Deployment are required for Azure OpenAI");
    return;
  }

  if (!isAzureOpenAI() && !deploymentOrModel) {
    alert("Model is required for OpenAI");
    return;
  }

  if (!key) {
    alert("API Key is required");
    return;
  }

  try {
    start_realtime(endpoint, key, deploymentOrModel);
  } catch (error) {
    console.log(error);
    setFormInputState(InputState.ReadyToStart);
  }
});

formStopButton.addEventListener("click", async () => {
  setFormInputState(InputState.Working);
  resetAudio(false);
  realtimeStreaming.close();
  setFormInputState(InputState.ReadyToStart);
});

formClearAllButton.addEventListener("click", async () => {
  formReceivedTextContainer.innerHTML = "";
});

formEndpointField.addEventListener('change', async () => {
  guessIfIsAzureOpenAI();
});
guessIfIsAzureOpenAI();

// Add these at the top with other event listeners
document.getElementById('start-screen-capture')?.addEventListener('click', startScreenCapture);
document.getElementById('stop-screen-capture')?.addEventListener('click', stopScreenCapture);

// Add these helper functions at the top
function estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
}

function estimateImageTokens(imageSize: number): number {
    // GPT-4V typically uses 85-170 tokens per 1024x1024 image
    // This is a rough estimate and may vary based on image complexity
    return Math.ceil(imageSize / 1024 / 1024 * 150);
}

function getDownscaledImageData(context: CanvasRenderingContext2D, sourceWidth: number, sourceHeight: number): ImageData {
  const tempCanvas = document.createElement('canvas');
  const tempContext = tempCanvas.getContext('2d')!;
  
  tempCanvas.width = Math.floor(sourceWidth * DOWNSCALE_FACTOR);
  tempCanvas.height = Math.floor(sourceHeight * DOWNSCALE_FACTOR);
  
  tempContext.drawImage(context.canvas, 0, 0, tempCanvas.width, tempCanvas.height);
  return tempContext.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
}

function getImageDifference(current: ImageData, previous: ImageData): number {
  const currentData = current.data;
  const previousData = previous.data;
  let diffCount = 0;
  
  for (let i = 0; i < currentData.length; i += 4) {
      if (
          Math.abs(currentData[i] - previousData[i]) > 10 || // R
          Math.abs(currentData[i + 1] - previousData[i + 1]) > 10 || // G
          Math.abs(currentData[i + 2] - previousData[i + 2]) > 10 // B
      ) {
          diffCount++;
      }
  }
  
  return diffCount / (currentData.length / 4);
}

async function captureAndAnalyzeFrame() {
    if (isAnalyzing) {
//       makeNewTextBlock("[Info]: Analysis already in progress, skipping");
        console.log("Analysis already in progress, skipping");
        return;
    }

    isAnalyzing = true;
    try {
        if (!screenStream || !context || !screenDisplay) return;
        
        const visionEndpoint = visionEndpointField.value.trim().replace(/\/+$/, '');
        const visionApiKey = visionApiKeyField.value.trim();
        const visionDeployment = visionDeploymentField.value.trim();

        if (!visionEndpoint || !visionApiKey || !visionDeployment) {
            makeNewTextBlock("[Error]: Please provide Vision API endpoint, key, and deployment");
            return;
        }

        // Set canvas dimensions to match video
        canvas.width = screenDisplay.videoWidth;
        canvas.height = screenDisplay.videoHeight;

        // Draw current frame to canvas
        context.drawImage(screenDisplay, 0, 0, canvas.width, canvas.height);
        
        // Get downscaled version for comparison
        const currentImageData = getDownscaledImageData(context, canvas.width, canvas.height);
        
        // Check if we have a previous frame to compare
        const previousImageData = lastAnalyzedImageData.get(context);
        if (previousImageData) {
            const difference = getImageDifference(currentImageData, previousImageData);
            if (difference < CHANGE_THRESHOLD) {
                console.log("Screen content hasn't changed significantly (less than 15% difference)");
//                makeNewTextBlock("[Info]: Screen content hasn't changed significantly (less than 15% difference)");
                return;
            }
            makeNewTextBlock(`[Info]: Screen content changed by approximately ${Math.round(difference * 100)}%`);
        }

        // Store downscaled version for future comparison
        lastAnalyzedImageData.set(context, currentImageData);
        // Convert to base64
        const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        
        // Estimate image tokens
        const imageBytes = atob(base64Image).length;
        const estimatedImageTokens = estimateImageTokens(imageBytes);
        
        // Estimate prompt tokens
        const promptText = "What do you see in this screen capture? Be sure to include any names of people or companies. Try to be concise.";
        const estimatedPromptTokens = estimateTokens(promptText);

        const totalInputTokens = estimatedImageTokens + estimatedPromptTokens;
        
        makeNewTextBlock(`[Token Estimate] Input: ~${totalInputTokens} tokens (${estimatedPromptTokens} text + ${estimatedImageTokens} image)`);

        // https://ai-johnmaedaraihub042109451234.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2025-01-01-preview
        // https://ai-johnmaedaraihub042109451234.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2025-01-01-preview

        //const uri = `${visionEndpoint}/openai/deployments/${visionDeployment}/chat/completions?api-version=2025-01-01-preview`;
        const uri = visionEndpoint;//

        console.log(uri);

        const response = await fetch(uri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': visionApiKey
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: promptText
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 300
            })
        });

        if (!response.ok) {
            if (response.status === 429) {
                makeNewTextBlock("[Error]: Rate limit exceeded. Please wait a moment before trying again.");
                return;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.choices && result.choices[0] && result.choices[0].message) {
            const responseText = result.choices[0].message.content;
            const estimatedResponseTokens = estimateTokens(responseText);
            
            makeNewTextBlock(`[Token Estimate] Output: ~${estimatedResponseTokens} tokens`);
            makeNewTextBlock(`[Token Estimate] Total: ~${totalInputTokens + estimatedResponseTokens} tokens`);
            makeNewTextBlock(`[Screen Analysis]: ${responseText}`);

            // If we have an active realtime conversation, inject the analysis
            if (realtimeStreaming && formStopButton.disabled === false) {
                try {
                    await realtimeStreaming.send({
                        type: "conversation.item.create" as const,
                        item: {
                            type: "message",
                            role: "user",
                            content: [
                                {
                                    type: "input_text",
                                    text: `[Screen content available but not mentioned unless relevant or referred to] ${responseText}`
                                }
                            ]
                        }
                    });
//                    makeNewTextBlock("[Info]: Screen analysis sent to conversation agent");
                    console.log("Screen analysis sent to conversation agent");
                    await realtimeStreaming.send({ type: "response.create" });
                } catch (error) {
                    console.error('Error sending screen analysis to conversation:', error);
                    makeNewTextBlock("[Error]: Failed to send screen analysis to conversation agent");
                }
            }
        }
    } catch (error: unknown) {
        console.error('Error analyzing screen:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to analyze screen';
        makeNewTextBlock(`[Error]: ${errorMessage}`);
    } finally {
        isAnalyzing = false;
    }
}

async function forceAnalyzeFrame() {
    if (isAnalyzing) {
//        makeNewTextBlock("[Info]: Analysis already in progress, skipping");
        console.log("Analysis already in progress, skipping");
        return;
    }

    // Temporarily clear the last analyzed image data to force a new analysis
    if (context) {
        lastAnalyzedImageData.delete(context);
    }
    
    // Call the regular analyze function
    await captureAndAnalyzeFrame();
}

// Add event listener for the analyze button
analyzeScreenButton.addEventListener('click', forceAnalyzeFrame);

// Add input event listeners to save settings when they change
formEndpointField.addEventListener('change', saveSettingsToCookies);
formApiKeyField.addEventListener('change', saveSettingsToCookies);
formDeploymentOrModelField.addEventListener('change', saveSettingsToCookies);
formAzureToggle.addEventListener('change', saveSettingsToCookies);
visionEndpointField.addEventListener('change', saveSettingsToCookies);
visionApiKeyField.addEventListener('change', saveSettingsToCookies);
visionDeploymentField.addEventListener('change', saveSettingsToCookies);

// Load settings when the page loads
document.addEventListener('DOMContentLoaded', loadSettingsFromCookies);

// Add these cookie management functions near the top of the file
function setCookie(name: string, value: string, days: number = 30) {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${encodeURIComponent(value)};${expires};path=/;SameSite=Strict`;
}

function getCookie(name: string): string {
  const nameEQ = `${name}=`;
  const ca = document.cookie.split(';');
  for (let c of ca) {
    while (c.charAt(0) === ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(nameEQ) === 0) {
      return decodeURIComponent(c.substring(nameEQ.length));
    }
  }
  return '';
}

function saveSettingsToCookies() {
  setCookie('endpoint', formEndpointField.value);
  setCookie('apiKey', formApiKeyField.value);
  setCookie('deploymentOrModel', formDeploymentOrModelField.value);
  setCookie('azureToggle', formAzureToggle.checked.toString());
  setCookie('visionEndpoint', visionEndpointField.value);
  setCookie('visionApiKey', visionApiKeyField.value);
  setCookie('visionDeployment', visionDeploymentField.value);
}

function loadSettingsFromCookies() {
  const endpoint = getCookie('endpoint');
  const apiKey = getCookie('apiKey');
  const deploymentOrModel = getCookie('deploymentOrModel');
  const azureToggle = getCookie('azureToggle');
  const visionEndpoint = getCookie('visionEndpoint');
  const visionApiKey = getCookie('visionApiKey');
  const visionDeployment = getCookie('visionDeployment');

  if (endpoint) formEndpointField.value = endpoint;
  if (apiKey) formApiKeyField.value = apiKey;
  if (deploymentOrModel) formDeploymentOrModelField.value = deploymentOrModel;
  if (azureToggle) formAzureToggle.checked = azureToggle === 'true';
  if (visionEndpoint) visionEndpointField.value = visionEndpoint;
  if (visionApiKey) visionApiKeyField.value = visionApiKey;
  if (visionDeployment) visionDeploymentField.value = visionDeployment;
}

let autoAnalyzeInterval: number | null = null;
let isAnalyzing = false;
const autoAnalyzeToggle = document.getElementById('auto-analyze') as HTMLInputElement;
const analyzeIntervalInput = document.getElementById('analyze-interval') as HTMLInputElement;

autoAnalyzeToggle.addEventListener('change', (e) => {
  toggleAutoAnalyze((e.target as HTMLInputElement).checked);
});

analyzeIntervalInput.addEventListener('change', () => {
  if (autoAnalyzeToggle.checked) {
      toggleAutoAnalyze(false);
      toggleAutoAnalyze(true);
  }
});

function toggleAutoAnalyze(enabled: boolean) {
    if (enabled) {
        const interval = parseInt(analyzeIntervalInput.value);
        if (interval < 1000) {
            makeNewTextBlock("[Warning]: Minimum interval is 1000ms. Setting to 1000ms.");
            analyzeIntervalInput.value = "1000";
        }
        
        autoAnalyzeInterval = window.setInterval(() => {
            captureAndAnalyzeFrame();
        }, Math.max(1000, interval));
        console.log(`[Info]: Auto-analyze enabled (${interval}ms interval)`);
//        makeNewTextBlock(`[Info]: Auto-analyze enabled (${interval}ms interval)`);
    } else {
        if (autoAnalyzeInterval) {
            clearInterval(autoAnalyzeInterval);
            autoAnalyzeInterval = null;
        }
        console.log("[Info]: Auto-analyze disabled");
//        makeNewTextBlock("[Info]: Auto-analyze disabled");
    }
}
