import { createContext, useContext, useState, ReactNode } from 'react';
import Toast from '../components/Toast';

interface ToastMessage {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [toastCounter, setToastCounter] = useState(0);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info', duration?: number) => {
    // Use counter + timestamp to ensure unique IDs even if called rapidly
    setToastCounter((prev) => {
      const newCounter = prev + 1;
      const id = `toast-${Date.now()}-${newCounter}`;
      setToasts((prevToasts) => [...prevToasts, { id, message, type, duration }]);
      return newCounter;
    });
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

