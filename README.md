# Vidhence - Your Personal AI Accountant (Offline-First)

Welcome to Vidhence, your dedicated financial assistant designed with a strong focus on **privacy and offline accessibility**. Vidhence empowers you to take control of your financial future by providing AI-powered insights for tax planning, savings, budgeting, and investments, all while keeping your sensitive financial data securely stored **locally on your device**. We never track or share your personal financial information.

## Project Overview

Vidhence aims to simplify personal finance management by offering a comprehensive suite of tools:
*   **Privacy-First:** All your data resides on your device, ensuring complete confidentiality.
*   **Offline-First:** Manage your finances anytime, anywhere, even without an internet connection.
*   **AI-Powered Insights:** Get personalized recommendations for optimizing taxes, accelerating savings, and making smarter investment decisions.
*   **Comprehensive Financial Tracking:** Easily manage income, track expenses, set savings goals, and monitor your investment portfolio.

## Key Features

*   **AI Tax Planning & Filing:** Maximize tax savings with personalized recommendations based on the latest tax laws.
*   **Budget Tracking:** Create and manage monthly budgets, track spending against allocations, and get insights into your spending habits.
*   **Savings Goals Management:** Set and monitor progress towards your financial goals, with calculated monthly and weekly saving targets.
*   **Investment Insights:** Get a clear overview of your long-term investments, diversification analysis, and actionable recommendations to grow your wealth.
*   **Transaction Management:** Easily record and categorize income and expenses, including credit card spends.
*   **Data Backup & Restore:** Securely backup your local financial data and restore it when needed.

## Technologies Used

This project is built with a modern web development stack, focusing on performance, developer experience, and a sleek user interface:

*   **React**: For building dynamic and responsive user interfaces.
*   **TypeScript**: Enhances code quality and developer productivity with static typing.
*   **Vite**: A fast and opinionated build tool for rapid development.
*   **Tailwind CSS**: A utility-first CSS framework for efficient and custom styling.
*   **shadcn/ui**: A collection of accessible UI components built with Radix UI and Tailwind CSS.
*   **React Router**: For seamless client-side navigation.
*   **IndexedDB**: The primary database for all client-side data storage, enabling offline capabilities.
*   **`bcryptjs`**: For secure client-side password hashing in local authentication.
*   **`lucide-react`**: A library of beautiful, pixel-perfect icons.
*   **`react-hook-form` & `zod`**: For robust form management and validation.
*   **`@tanstack/react-query`**: Used for managing local state, caching, and synchronization with IndexedDB.
*   **`date-fns` & `date-fns-tz`**: For comprehensive date and time manipulation, with timezone support.
*   **`sonner`**: For elegant toast notifications.

## Getting Started (Local Development)

To set up and run Vidhence on your local machine, follow these steps:

1.  **Prerequisites:**
    *   Node.js (v18 or higher recommended)
    *   npm (usually comes with Node.js)

2.  **Clone the Repository:**
    ```sh
    git clone <YOUR_GIT_URL>
    cd vidhence-app
    ```

3.  **Install Dependencies:**
    ```sh
    npm install
    ```

4.  **Start the Development Server:**
    ```sh
    npm run dev
    ```
    This will start the development server, and you can access the application in your browser, typically at `http://localhost:8080`.

## Deployment

Vidhence is designed as a static web application that runs entirely client-side, leveraging IndexedDB for data storage. To deploy:

1.  **Build for Production:**
    ```sh
    npm run build
    ```
    This command will create an optimized `dist` directory containing all the static files (HTML, CSS, JavaScript, assets).

2.  **Host Static Files:**
    Upload the contents of the `dist` directory to any static site hosting service (e.g., Vercel, Netlify, GitHub Pages, AWS S3). The application will function fully once served, as all data operations are handled client-side.