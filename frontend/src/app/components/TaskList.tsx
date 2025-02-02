"use client";
import { useEffect, useState } from "react";
import { Task } from "../../types/types";
// interface Task {
//   id: string;
//   status: "pending" | "completed" | "failed";
//   retries: number;
// }

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Fetch initial tasks from API
    fetch("http://localhost:3000/api/tasks")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new TypeError("Expected JSON response");
        }
        return res.json();
      })
      .then((data) => {
        console.log('Received tasks:', data);
        setTasks(data);
        setError(null);
      })
      .catch(error => {
        console.error('Error fetching tasks:', error);
        setError(error.message);
      })
      .finally(() => {
        setLoading(false);
      });

    // Connect to WebSocket
    const ws = new WebSocket("ws://localhost:3000");

    ws.onmessage = (event) => {
      const updatedTask: Task = JSON.parse(event.data);
      setTasks((prev) =>
        prev.map((task) =>
          task.id === updatedTask.id ? updatedTask : task
        )
      );
    };

    return () => ws.close();
  }, []);
  if (error) {
    return <div className="text-red-500">Error loading tasks: {error}</div>;
  }

  return (
    <div className="space-y-4">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="p-4 border rounded-lg bg-white shadow-sm"
        >
          <p>Task ID: {task.id}</p>
          <p>Status: {task.status}</p>
          <p>Retries: {task.retries}</p>
        </div>
      ))}
    </div>
  );
}