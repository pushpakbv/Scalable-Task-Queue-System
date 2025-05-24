/**
 * API client module for making requests to the backend
 */

// API base URL with fallback for local development
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const WEBSOCKET_URL = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'ws://localhost:3000';

/**
 * Make a GET request to the API
 */
export async function fetchGet(endpoint: string) {
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching from ${endpoint}:`, error);
    throw error;
  }
}

/**
 * Make a POST request to the API
 */
export async function fetchPost(endpoint: string, data: any) {
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      // Try to parse error response
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: `API error: ${response.status}` };
      }
      throw new Error(errorData.error || `API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error posting to ${endpoint}:`, error);
    throw error;
  }
}

/**
 * Create a WebSocket connection to the backend
 */
export function createWebSocketConnection() {
  try {
    return new WebSocket(WEBSOCKET_URL);
  } catch (error) {
    console.error('Error creating WebSocket connection:', error);
    throw error;
  }
}
