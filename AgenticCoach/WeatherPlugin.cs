using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;
using System.ComponentModel;

public class WeatherPlugin
{
    private readonly HttpClient _httpClient;
    private string ApiKey;
    private const string ApiBaseUrl = "https://api.openweathermap.org/data/2.5/weather";

    public WeatherPlugin(string apiKey)
    {
        ApiKey = apiKey;
        _httpClient = new HttpClient();
    }

    [KernelFunction]
    [Description("Retrieves the current weather for a city.")]
    public async Task<string> GetWeatherAsync(string city)
    {
        try
        {
            string url = $"{ApiBaseUrl}?q={city}&appid={ApiKey}&units=metric"; // Fetch data in metric units (Celsius)
            HttpResponseMessage response = await _httpClient.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                return $"Error fetching weather data: {response.StatusCode}";
            }

            string jsonResponse = await response.Content.ReadAsStringAsync();

            // Parse the JSON response
            var weatherData = JsonSerializer.Deserialize<WeatherResponse>(jsonResponse, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (weatherData == null)
            {
                return "Error parsing weather data.";
            }

            // Format the output
            return $"Weather in {weatherData.Name}, {weatherData.Sys.Country}:\n" +
                   $"Temperature: {weatherData.Main.Temp}°C (Feels like {weatherData.Main.Feels_Like}°C)\n" +
                   $"Condition: {weatherData.Weather[0].Main} - {weatherData.Weather[0].Description}\n" +
                   $"Humidity: {weatherData.Main.Humidity}%\n" +
                   $"Wind Speed: {weatherData.Wind.Speed} m/s\n";
        }
        catch (Exception ex)
        {
            return $"An error occurred: {ex.Message}";
        }
    }

    private class WeatherResponse
    {
        public Coord Coord { get; set; }
        public Weather[] Weather { get; set; }
        public Main Main { get; set; }
        public Wind Wind { get; set; }
        public Sys Sys { get; set; }
        public string Name { get; set; }
    }

    private class Coord
    {
        public float Lon { get; set; }
        public float Lat { get; set; }
    }

    private class Weather
    {
        public string Main { get; set; }
        public string Description { get; set; }
    }

    private class Main
    {
        public float Temp { get; set; }
        public float Feels_Like { get; set; }
        public float Pressure { get; set; }
        public int Humidity { get; set; }
    }

    private class Wind
    {
        public float Speed { get; set; }
        public int Deg { get; set; }
    }

    private class Sys
    {
        public string Country { get; set; }
    }
}
