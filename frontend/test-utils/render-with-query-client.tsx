import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { render } from "@testing-library/react";

export const renderWithQueryClient = (
  ui: Readonly<React.ReactElement>,
): ReturnType<typeof render> => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  }),
    wrapper = class QueryClientWrapper extends React.Component<
      Readonly<React.PropsWithChildren>
    > {
      render(): React.ReactNode {
        return (
          <QueryClientProvider client={client}>
            {this.props.children}
          </QueryClientProvider>
        );
      }
    };

  return render(ui, {
    wrapper,
  });
};
