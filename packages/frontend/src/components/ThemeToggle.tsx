import { useTheme } from '../context/ThemeContext';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={() => toggleTheme()}
      type="button"
      className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {/* Toggle circle */}
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-300 shadow-md transition-transform duration-200 ${
          theme === 'dark' ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
      {/* Sun icon for light mode */}
      <span
        className={`absolute left-1.5 transition-opacity duration-200 text-xs ${
          theme === 'light' ? 'opacity-100 text-yellow-500' : 'opacity-0'
        }`}
      >
        ☀️
      </span>
      {/* Moon icon for dark mode */}
      <span
        className={`absolute right-1.5 transition-opacity duration-200 text-xs ${
          theme === 'dark' ? 'opacity-100 text-blue-300' : 'opacity-0'
        }`}
      >
        🌙
      </span>
      <span className="sr-only">{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span>
    </button>
  );
}
