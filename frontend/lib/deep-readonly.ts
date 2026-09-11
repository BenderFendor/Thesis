import type { ReactElement, RefObject } from "react";

type DeepReadonlyAtomic = Element | ReactElement | RefObject<unknown>;

/** Recursively marks data members readonly while preserving runtime values. */
export type DeepReadonly<Value> =
  Value extends string | number | boolean | bigint | symbol | null | undefined
    ? Value
    : Value extends (...arguments_: readonly never[]) => infer _Return
    ? Value
    : Value extends DeepReadonlyAtomic
      ? Value
    : Value extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;
