exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ ok: true, service: "anfiteatro-sheets-backend" }),
});
