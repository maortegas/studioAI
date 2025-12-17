import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="px-4 py-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">DevFlow Studio</h1>
        <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
          AI-powered software project management tool
        </p>
        <div className="space-x-4">
          <Link
            to="/projects"
            className="inline-block bg-blue-600 dark:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 dark:hover:bg-blue-600 transition"
          >
            View Projects
          </Link>
        </div>
      </div>

      <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">Project Management</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Create and manage software projects with full lifecycle tracking
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">AI-Powered</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Generate documentation, user stories, and code using local AI tools
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">Stage Tracking</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Track progress through Idea, Design, Stories, Roadmap, Implementation, QA, and Release
          </p>
        </div>
      </div>
    </div>
  );
}

