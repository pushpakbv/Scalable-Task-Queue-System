"use client"; // Mark as client component
import { useState } from "react";
import { fetchPost } from "../api/apiClient";

export default function TaskForm() {
  const [imageUrl, setImageUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    
    try {
      // API call to submit task using the apiClient
      await fetchPost("/api/tasks", { type: "image_resize", imageUrl });
      setImageUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit task");
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder="Image URL"
        className="w-full p-2 border rounded"
        disabled={isSubmitting}
      />
      {error && <div className="text-red-500 text-sm">{error}</div>}
      <button
        type="submit"
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-blue-300"
        disabled={isSubmitting || !imageUrl}
      >
        {isSubmitting ? "Submitting..." : "Submit Task"}
      </button>
    </form>
  );
}
//test change