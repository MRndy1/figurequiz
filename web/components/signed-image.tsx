"use client";

import { useState, type ImgHTMLAttributes } from "react";

/**
 * An image behind a signed URL that keeps the first URL it was given. A page that refreshes
 * itself (RefreshWhile) signs the same image again each time, with a new token, and a plain
 * <img> would download it again on every refresh.
 */
export function SignedImage({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [first] = useState(src);
  // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs, no loader
  return <img src={first} alt={alt} {...rest} />;
}
