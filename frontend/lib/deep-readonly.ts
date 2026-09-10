/** Recursively marks object and collection members readonly while preserving callable values. */
export type DeepReadonly<Value> =
  Value extends (...arguments_: never[]) => infer _Return
    ? Value
    : Value extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;
