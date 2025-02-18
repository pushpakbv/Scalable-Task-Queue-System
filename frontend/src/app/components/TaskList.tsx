"use client";
import { useEffect, useState } from "react";
import { Task } from "../../types/types";

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Fetch initial tasks from API
    fetch("http://localhost:3000/api/tasks")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const contentType = res.headers.get("content-type");
        if (!contentType?.includes("application/json")) throw new TypeError("Expected JSON");
        return res.json();
      })
      .then((data) => {
        setTasks(data);
        setError(null);
      })
      .catch((error) => setError(error.message))
      .finally(() => setLoading(false));

    // ✅ Connect to WebSocket endpoint at port 3000 (backend)
    const ws = new WebSocket("ws://localhost:3000");

    ws.onmessage = (event) => {
      const updatedTask: Task = JSON.parse(event.data);
      setTasks((prev) => {
        // Add new task or update existing
        const exists = prev.some((t) => t.id === updatedTask.id);
        return exists 
          ? prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)) 
          : [...prev, updatedTask];
      });
    };

    return () => ws.close();
  }, []);

  if (error) return <div className="text-red-500">Error: {error}</div>;
  if (loading) return <div>Loading tasks...</div>;

  return (
    <div className="space-y-4">
      {tasks.map((task) => (
        <div key={task.id} className="p-4 border rounded-lg bg-white shadow-sm">
          <p>Task ID: {task.id}</p>
          <p>Status: {task.status}</p>
          <div className={`status-badge ${task.retries > 0 ? 'bg-yellow-100' : ''}`}>
            Retries: {task.retries}
          </div>
        </div>
      ))}
    </div>
  );
}