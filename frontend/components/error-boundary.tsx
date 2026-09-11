"use client";

import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

interface Props {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  private readonly handleReset = (): void => {
    globalThis.location.reload();
  };

  public static getDerivedStateFromError(error: Error): State {
    return { error, hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: Readonly<ErrorInfo>): void {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    const errorState = this.state;
    if (errorState?.hasError ?? false) {
      return (
        this.props.fallback ?? (
          <div className="p-4 bg-red-50 text-red-700 rounded-md">
            <h2 className="font-bold">Something went wrong</h2>
            <p>{errorState.error?.message ?? "An unexpected error occurred"}</p>
            <button
              onClick={this.handleReset}
              className="mt-2 px-4 py-2 bg-red-100 hover:bg-red-200 rounded-md"
            >
              Try again
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
