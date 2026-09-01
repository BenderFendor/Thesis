declare module "d3-geo" {
  interface GeoCentroidInput {
    readonly geometry?: Readonly<{ readonly coordinates?: unknown }> | null;
    readonly properties?: Readonly<{
      readonly ADM0_A3?: string;
      readonly ISO_A2?: string;
      readonly NAME?: string;
    }>;
    readonly type?: string;
  }

  /** Return the spherical centroid as [longitude, latitude] in degrees. */
  export function geoCentroid(input: GeoCentroidInput): [number, number];
}
