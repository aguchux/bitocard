import Image from "next/image";
import { brand } from "./site";

/** Logo mark and wordmark. Each app serves the logo from its own public/ folder. */
export function Brand() {
  return (
    <>
      <span className="brand-icon" aria-hidden="true">
        <Image src={brand.logo} alt="" width={1280} height={1280} sizes="80px" />
      </span>
      <span className="brand-name">Bito<span className="brand-accent">Card</span></span>
    </>
  );
}
