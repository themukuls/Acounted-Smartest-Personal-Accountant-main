# AI Rules for Vidhence Application Development

This document outlines the core technologies used in the Vidhence application and provides clear guidelines for using specific libraries and frameworks. Adhering to these rules ensures consistency, maintainability, and optimal performance across the codebase.

## Tech Stack Overview

The Vidhence application is built using a modern web development stack, focusing on performance, developer experience, and a sleek user interface.

*   **React**: A declarative, component-based JavaScript library for building user interfaces.
*   **TypeScript**: A superset of JavaScript that adds static typing, enhancing code quality and developer productivity.
*   **Vite**: A fast and opinionated build tool that provides an instant development server and optimized production builds.
*   **Tailwind CSS**: A utility-first CSS framework for rapidly building custom designs directly in your markup.
*   **shadcn/ui**: A collection of reusable components built with Radix UI and styled with Tailwind CSS, providing a consistent and accessible UI.
*   **React Router**: A standard library for declarative routing in React applications.
*   **IndexedDB**: For all client-side data storage, providing offline capabilities.
*   **`bcryptjs`**: For client-side password hashing in local authentication.
*   **`lucide-react`**: A library of beautiful, pixel-perfect icons for React applications.
*   **`react-hook-form` & `zod`**: Libraries for efficient form management and robust schema-based validation.
*   **`@tanstack/react-query`**: A powerful data-fetching library for managing server state, caching, and synchronization (will be adapted for local state management).
*   **`date-fns` & `date-fns-tz`**: A comprehensive and consistent toolset for manipulating JavaScript dates.

## Library Usage Guidelines

To maintain a cohesive and efficient codebase, please follow these guidelines when developing new features or modifying existing ones:

*   **UI Components**:
    *   **Always** prioritize `shadcn/ui` components for all user interface elements.
    *   If a specific `shadcn/ui` component is not available or requires significant deviation from its intended design, create a **new, custom component** in `src/components/` using Tailwind CSS.
    *   **Never** directly modify the source files of `shadcn/ui` components (e.g., files in `src/components/ui/`).
*   **Styling**:
    *   **Exclusively** use Tailwind CSS utility classes for all styling.
    *   Avoid writing custom CSS in `.css` files or using inline styles, unless absolutely necessary for highly specific, isolated cases (which should be rare).
*   **State Management**:
    *   For local component state, use React's built-in `useState` and `useReducer` hooks.
    *   For global application state, and local data fetching/caching, use `@tanstack/react-query` (adapted for IndexedDB).
*   **Routing**:
    *   Use `react-router-dom` for all client-side navigation and route definitions. Keep main routes in `src/App.tsx`.
*   **Forms & Validation**:
    *   Implement all forms using `react-hook-form` for efficient form state management.
    *   Use `zod` for defining form schemas and performing validation.
*   **Backend Interaction**:
    *   All user data and authentication must be handled using **IndexedDB** via the custom services in `src/integrations/indexeddb/services/`.
    *   A minimal online service (`src/services/appUpdateService.ts`) can be used for fetching non-personal app updates or notifications.
*   **Icons**:
    *   Use icons from the `lucide-react` library.
*   **Notifications**:
    *   For toast notifications, prefer using `sonner` for new implementations.
*   **Date & Time Handling**:
    *   Use `date-fns` and `date-fns-tz` for all date and time manipulation, ensuring consistent handling of timezones (especially IST).