export interface Task {
    id: string;
    status: "pending" | "in_progress" | "completed" | "failed";
    data: {
      type: string;
      imageUrl?: string;
    };
    retries: number;
    createdAt: string;
  }