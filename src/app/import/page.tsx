import type { Metadata } from "next";
import { Suspense } from "react";
import { catalog, dataset } from "@/lib/data";
import { ImportForm } from "@/components/ImportForm";

export const metadata: Metadata = { title: "导入评论 · PhoneLens" };

export default function ImportPage() {
  return (
    <>
      <h1 className="page-title enter">导入你自己的评论</h1>
      <p className="page-lead enter" style={{ ["--i" as string]: 1 }}>
        为已收录机型补充你有权使用的评论，或为目录外机型做一份口碑摘要。结果只在本页显示，不进入公共数据。
      </p>
      <Suspense fallback={null}>
        <ImportForm catalog={catalog(dataset)} />
      </Suspense>
    </>
  );
}
