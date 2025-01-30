import TaskForm from "./components/TaskForm";

export default function Home() {
  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        Task Queue Dashboard
      </h1>
      <TaskForm />
    </main>
  );
}