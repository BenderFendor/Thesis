import { promoteRssSource, validateRssUrl } from "@/lib/api";
import type { AddRssResponse } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useCallback, useState } from "react";
import type { ChangeEventHandler, Dispatch, KeyboardEventHandler, SetStateAction } from "react";

interface RssDialogState {
  readonly open: boolean;
  readonly url: string;
  readonly validating: boolean;
  readonly adding: boolean;
  readonly validationResult: DeepReadonly<AddRssResponse> | null;
  readonly reviewName: string;
  readonly reviewCountry: string;
  readonly reviewSourceType: string;
  readonly reviewPaywalled: boolean;
  readonly error: string | null;
}

interface RssDialogController extends RssDialogState {
  readonly handleAdd: () => Promise<void>;
  readonly handleAddClick: () => void;
  readonly handleOpenChange: (next: boolean) => void;
  readonly handleReviewCountryChange: (value: string) => void;
  readonly handleReviewNameChange: (value: string) => void;
  readonly handleReviewPaywalledChange: (value: boolean) => void;
  readonly handleReviewSourceTypeChange: (value: string) => void;
  readonly handleUrlChange: ChangeEventHandler<HTMLInputElement>;
  readonly handleUrlKeyDown: KeyboardEventHandler<HTMLInputElement>;
  readonly handleValidate: () => Promise<void>;
  readonly handleValidateClick: () => void;
}

const INITIAL_RSS_DIALOG_STATE: RssDialogState = {
  adding: false,
  error: null,
  open: false,
  reviewCountry: "",
  reviewName: "",
  reviewPaywalled: false,
  reviewSourceType: "",
  url: "",
  validating: false,
  validationResult: null,
};

type RssDialogStateSetter = Dispatch<SetStateAction<Readonly<RssDialogState>>>;

const setRssError = (setState: RssDialogStateSetter, message: string): void => {
  setState((previous) => ({ ...previous, error: message }));
};

const applyValidationResult = (
  setState: RssDialogStateSetter,
  result: DeepReadonly<AddRssResponse>,
): void => {
  setState((previous) => ({
    ...previous,
    error: null,
    reviewCountry: result.inferred?.country ?? "",
    reviewName: result.name,
    reviewPaywalled: result.inferred?.is_paywalled ?? false,
    reviewSourceType: result.inferred?.source_type ?? "",
    validationResult: result,
  }));
};

const runRssValidation = async (url: string, setState: RssDialogStateSetter): Promise<void> => {
  try {
    const result = await validateRssUrl(url);
    applyValidationResult(setState, result);
  } catch (caughtError) {
    if (caughtError instanceof Error) {
      setRssError(setState, caughtError.message);
    } else {
      setRssError(setState, "Validation failed");
    }
  }
};

const useRssValidation = (url: string, setState: RssDialogStateSetter): (() => Promise<void>) =>
  useCallback(async () => {
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      return;
    }
    setState((previous) => ({
      ...previous,
      error: null,
      validating: true,
      validationResult: null,
    }));
    await runRssValidation(trimmed, setState);
    setState((previous) => ({ ...previous, validating: false }));
  }, [setState, url]);

type RssPromotionState = DeepReadonly<
  Pick<
    RssDialogState,
    | "reviewCountry"
    | "reviewName"
    | "reviewPaywalled"
    | "reviewSourceType"
    | "url"
    | "validationResult"
  >
>;

const finishRssPromotion = (
  setState: RssDialogStateSetter,
  onSourceAdded: (() => void) | undefined,
): void => {
  setState((previous) => ({
    ...previous,
    error: null,
    open: false,
    url: "",
    validationResult: null,
  }));
  onSourceAdded?.();
};

const runRssPromotion = async (
  state: RssPromotionState,
  setState: RssDialogStateSetter,
  onSourceAdded: (() => void) | undefined,
): Promise<void> => {
  if (state.validationResult === null) {
    return;
  }
  setState((previous) => ({ ...previous, adding: true }));
  try {
    await promoteRssSource({
      country: state.reviewCountry.trim(),
      is_paywalled: state.reviewPaywalled,
      name: state.reviewName.trim() || state.validationResult.name,
      source_type: state.reviewSourceType.trim(),
      url: state.url.trim(),
    });
    finishRssPromotion(setState, onSourceAdded);
  } catch (caughtError) {
    if (caughtError instanceof Error) {
      setRssError(setState, caughtError.message);
    } else {
      setRssError(setState, "Failed to add source");
    }
  } finally {
    setState((previous) => ({ ...previous, adding: false }));
  }
};

const useRssPromotion = (
  state: DeepReadonly<RssDialogState>,
  setState: RssDialogStateSetter,
  onSourceAdded: (() => void) | undefined,
): (() => Promise<void>) => {
  const { reviewCountry, reviewName, reviewPaywalled, reviewSourceType, url, validationResult } =
    state;
  return useCallback(
    () =>
      runRssPromotion(
        { reviewCountry, reviewName, reviewPaywalled, reviewSourceType, url, validationResult },
        setState,
        onSourceAdded,
      ),
    [
      onSourceAdded,
      reviewCountry,
      reviewName,
      reviewPaywalled,
      reviewSourceType,
      setState,
      url,
      validationResult,
    ],
  );
};

const useRssFormActions = (
  setState: RssDialogStateSetter,
  handleValidate: () => Promise<void>,
  handleAdd: () => Promise<void>,
) => {
  const handleAddClick = useCallback(() => {
      void handleAdd();
    }, [handleAdd]),
    handleOpenChange = useCallback(
      (next: boolean) => {
        if (!next) {
          setState(INITIAL_RSS_DIALOG_STATE);
          return;
        }
        setState((previous) => ({ ...previous, open: true }));
      },
      [setState],
    ),
    handleUrlChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
      (event) => {
        setState((previous) => ({
          ...previous,
          error: null,
          url: event.target.value,
          validationResult: null,
        }));
      },
      [setState],
    ),
    handleUrlKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>(
      (event) => {
        if (event.key === "Enter") {
          void handleValidate();
        }
      },
      [handleValidate],
    ),
    handleValidateClick = useCallback(() => {
      void handleValidate();
    }, [handleValidate]);
  return {
    handleAddClick,
    handleOpenChange,
    handleUrlChange,
    handleUrlKeyDown,
    handleValidateClick,
  };
};

const useRssReviewActions = (setState: RssDialogStateSetter) => {
  const handleReviewCountryChange = useCallback(
      (value: string) => {
        setState((previous) => ({ ...previous, reviewCountry: value }));
      },
      [setState],
    ),
    handleReviewNameChange = useCallback(
      (value: string) => {
        setState((previous) => ({ ...previous, reviewName: value }));
      },
      [setState],
    ),
    handleReviewPaywalledChange = useCallback(
      (value: boolean) => {
        setState((previous) => ({ ...previous, reviewPaywalled: value }));
      },
      [setState],
    ),
    handleReviewSourceTypeChange = useCallback(
      (value: string) => {
        setState((previous) => ({ ...previous, reviewSourceType: value }));
      },
      [setState],
    );
  return {
    handleReviewCountryChange,
    handleReviewNameChange,
    handleReviewPaywalledChange,
    handleReviewSourceTypeChange,
  };
};

const useAddRssDialogController = (
  onSourceAdded: (() => void) | undefined,
): RssDialogController => {
  const [state, setState] = useState<Readonly<RssDialogState>>(INITIAL_RSS_DIALOG_STATE);
  const handleValidate = useRssValidation(state.url, setState);
  const handleAdd = useRssPromotion(state, setState, onSourceAdded);
  const formActions = useRssFormActions(setState, handleValidate, handleAdd);
  const reviewActions = useRssReviewActions(setState);
  return { ...state, ...formActions, ...reviewActions, handleAdd, handleValidate };
};

export { useAddRssDialogController };
export type { RssDialogController };
