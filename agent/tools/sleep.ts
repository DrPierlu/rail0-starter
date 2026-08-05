import { sleep } from "eve/tools/sleep";

// Enabled because the instructions tell the model to re-check order_status while the
// escrow confirms, and without this its only options were to poll immediately (which is
// what produced a stack of identical status checks) or to end the turn.
//
// The pause sleeps the durable turn workflow rather than holding a runtime open, so
// waiting out a slow chain costs nothing — and some chains are genuinely slow: Arbitrum
// Sepolia asks for 2700 confirmations.
export default sleep();
