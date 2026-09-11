import { Component, type ReactNode } from 'react';
export class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p>Não foi possível carregar esta tela. Recarregue para tentar novamente.</p>
      <button className="rounded-md bg-primary text-primary-foreground px-4 py-2" onClick={() => window.location.reload()}>Recarregar tela</button>
    </div>;
  }
}
