import { useEffect, useState } from 'react';

interface SSEEvent {
  type: string;
  data: any;
}

export function useSSE() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const clientId = `client-${Date.now()}`;
    const eventSource = new EventSource(`/api/events/stream?clientId=${clientId}`);

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setEvents((prev) => [...prev, { type: data.type, data: data.data || data }]);
      } catch (error) {
        console.error('Failed to parse SSE event:', error);
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []);

  return { events, connected };
}

