import Image from "next/image";

export function Brand() {
  return (
    <>
      <span className="brand-icon" aria-hidden="true">
        <Image src="/bitocard-logo.png" alt="" width={1280} height={1280} sizes="80px" />
      </span>
      <span className="brand-name">Bito<span className="brand-accent">Card</span></span>
    </>
  );
}
