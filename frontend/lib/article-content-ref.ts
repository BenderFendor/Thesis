const
 getArticleContentRef = (value: Readonly<object> | null): React.Ref<HTMLDivElement> | undefined => {
  if (value !== null && isArticleContentRef(value)) {
    return value;
  }
  return undefined;
},

 isArticleContentRef = (value: Readonly<object> | null): value is React.Ref<HTMLDivElement> =>
  value instanceof globalThis.Function ||
  value instanceof globalThis.Object && "current" in value;

export { getArticleContentRef };
