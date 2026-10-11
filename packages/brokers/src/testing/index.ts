/**
 * What other packages' tests may build broker files with: workbooks, and
 * eToro statements, written at test time. Exported under the `source`
 * condition only (`@taxreporter/brokers/testing`), so it never reaches a
 * build: the tests run on sources, and `dist` leaves `src/testing` out.
 */
export * from "./etoro.js";
export * from "./workbook.js";
