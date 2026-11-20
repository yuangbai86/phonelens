import type { Metadata } from "next";
import { Suspense } from "react";
import { CompareClient } from "@/components/result/CompareClient";
import Loading from "./loading";

export const metadata: Metadata = { title: "对比结果 · PhoneLens" };

/** 静态页面外壳；对比条件来自地址栏，计算在浏览器中完成 */
export default function ComparePage() {
  return (
    <Suspense fallback={<Loading />}>
      <CompareClient />
    </Suspense>
  );
}
