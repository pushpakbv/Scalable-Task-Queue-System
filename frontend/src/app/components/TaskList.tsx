"use client";
import { useEffect, useState } from "react";
import { Task } from "../../types/types";
import { fetchGet, createWebSocketConnection } from "../api/apiClient";

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    let isMounted = true;
    
    const loadTasks = async () => {
      setLoading(true);
      try {
        // Fetch initial tasks using the API client
        const data = await fetchGet("/api/tasks");
        if (isMounted) {
          setTasks(data);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to fetch tasks");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    loadTasks();
    
    // Connect to WebSocket using the API client
    let ws: WebSocket;
    try {
      ws = createWebSocketConnection();
      
      ws.onopen = () => {
        if (isMounted) setWsConnected(true);
      };
      
      ws.onclose = () => {
        if (isMounted) setWsConnected(false);
      };
      
      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        if (isMounted) setError("WebSocket connection error");
      };
      
      ws.onmessage = (event) => {
        try {
          const updatedTask: Task = JSON.parse(event.data);
          if (isMounted) {
            setTasks((prev) => {
              // Add new task or update existing
              const exists = prev.some((t) => t.id === updatedTask.id);
              return exists 
                ? prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)) 
                : [...prev, updatedTask];
            });
          }
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };
    } catch (err) {
      console.error("Failed to establish WebSocket connection:", err);
      if (isMounted) {
        setError("Failed to establish real-time connection");
      }
    }

    return () => {
      isMounted = false;
      if (ws) ws.close();
    };
  }, []);

  if (error) return <div className="text-red-500">Error: {error}</div>;
  if (loading) return <div>Loading tasks...</div>;

  return (
    <div className="space-y-4">
      {wsConnected && <div className="text-green-600 text-sm mb-2">Real-time updates connected</div>}
      {!wsConnected && !error && <div className="text-yellow-600 text-sm mb-2">Real-time updates disconnected</div>}
      
      {tasks.length === 0 ? (
        <div className="text-gray-500 p-4 text-center border rounded-lg">No tasks found</div>
      ) : (
        tasks.map((task) => (
          <div 
            key={task.id} 
            className={`p-4 border rounded-lg shadow-sm ${
              task.status === 'completed' ? 'bg-green-50' : 
              task.status === 'failed' ? 'bg-red-50' : 
              task.status === 'in_progress' ? 'bg-blue-50' : 'bg-white'
            }`}
          >
            <p className="font-medium">Task ID: {task.id}</p>
            <p>Type: {task.data?.type || 'Unknown'}</p>
            <p>Status: <span className="font-medium">{task.status}</span></p>
            <div className={`mt-1 text-sm ${task.retries > 0 ? 'text-yellow-700 bg-yellow-100 px-2 py-1 rounded' : ''}`}>
              Retries: {task.retries}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
