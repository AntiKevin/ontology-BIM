// =================================================================================
// MÓDULO DE CONTROLE DO GRAFO (VIS-NETWORK)
// =================================================================================

// Variável global para manter a instância da rede do grafo
let network = null;

// Aplica estilos visuais aos nós do grafo com base no seu estado (válido ou com erro).
const applyNodeStyles = (graphData, conflictMessages) => {
    if (!graphData || !graphData.nodes) return graphData;

    const conflictGuids = new Set(Object.keys(conflictMessages).map(key => key.replace('ifc:', '')));

    graphData.nodes.forEach(node => {
        // Ignora nós que já têm uma cor definida (ex: nó central verde)
        if (node.color && typeof node.color === 'string') {
            return;
        }

        const nodeGuid = node.id.substring(node.id.lastIndexOf('#') + 1) || node.id.substring(node.id.lastIndexOf('/') + 1);
        
        if (conflictGuids.has(nodeGuid)) {
            // --- ESTILO PARA NÓS COM ERRO DE VALIDAÇÃO ---
            node.color = {
                background: '#FECACA',      // Fundo: Vermelho claro
                border: '#F87171',          // Borda: Vermelho médio
                highlight: {                // Ao ser selecionado (clique)
                    background: '#C94A4A',  // Fundo: Vermelho Tijolo
                    border: '#991B1B'
                },
                hover: {                    // Ao passar o mouse
                    background: '#FECACA',
                    border: '#EF4444'       // Apenas escurece a borda
                }
            };

            const originalUri = Object.keys(conflictMessages).find(key => key.endsWith(nodeGuid));
            if (originalUri && conflictMessages[originalUri]) {
                const tooltipElement = document.createElement('div');
                tooltipElement.style.whiteSpace = 'normal';
                tooltipElement.style.wordWrap = 'break-word';
                tooltipElement.innerHTML = `<div style="font-weight: bold; color: #B91C1C;">⚠️ Conflito</div><div>${conflictMessages[originalUri]}</div>`;
                node.title = tooltipElement;
            }
        } else {
            // --- ESTILO PARA NÓS VÁLIDOS (PADRÃO) ---
            node.color = {
                background: '#BFDBFE',      // Fundo: Azul claro
                border: '#60A5FA',          // Borda: Azul médio
                highlight: {                // Ao ser selecionado (clique)
                    background: '#FBBF24',  // Fundo: Amarelo/Âmbar
                    border: '#D97706'
                },
                hover: {                    // Ao passar o mouse
                    background: '#BFDBFE',
                    border: '#3B82F6'       // Apenas escurece a borda
                }
            };
        }
    });

    return graphData;
};

// Função principal que desenha ou redesenha o grafo no container.
export const drawGraph = (graphData, conflictMessages, addChatMessageCallback) => {
    const graphContainer = document.getElementById('graph-container');
    if (network) { network.destroy(); network = null; }
    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
         graphContainer.innerHTML = '<p class="p-4 text-gray-500 text-center">Nenhum dado para visualizar.</p>';
         return;
    }

    // Aplica os estilos (cores, etc.) aos dados antes de desenhar
    const styledGraphData = applyNodeStyles(graphData, conflictMessages);
    
    const data = { 
        nodes: new vis.DataSet(styledGraphData.nodes), 
        edges: new vis.DataSet(styledGraphData.edges) 
    };
    
    // Opções de configuração da aparência e física do grafo
    const options = {
        nodes: { shape: 'box', margin: 15, widthConstraint: { minimum: 150 }, font: { color: '#111827' } },
        edges: {
            font: { align: 'middle', size: 12, color: '#4b5563', background: 'rgba(255, 255, 255, 0.8)', strokeWidth: 0 },
            smooth: { type: 'continuous' },
            color: { color: '#a0aec0', inherit: false }
        },
        physics: { 
            solver: 'barnesHut', 
            barnesHut: { gravitationalConstant: -60000, centralGravity: 0.25, springLength: 400, springConstant: 0.02, damping: 0.3, avoidOverlap: 1 }
        },
        interaction: { hover: true, navigationButtons: true, keyboard: true, tooltipDelay: 200 }
    };

    graphContainer.innerHTML = '';
    network = new vis.Network(graphContainer, data, options);
    network.on("stabilizationIterationsDone", () => network.setOptions({ physics: false }));

    // Evento de duplo clique para explorar um nó e suas relações
    network.on("doubleClick", async (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const nodeObject = data.nodes.get(nodeId);
            addChatMessageCallback(`Explorando: '${nodeObject.label}'`, 'user');
            const graphResponse = await fetch(`/graph-data?object=${encodeURIComponent(nodeObject.label)}`);
            const newGraphData = await graphResponse.json();
            
            // Colore o nó central do novo grafo de forma condicional
            if (newGraphData.nodes && newGraphData.nodes.length > 0) {
                const centralNode = newGraphData.nodes.find(n => n.id === nodeId);
                if (centralNode) {
                    const guid = centralNode.id.substring(centralNode.id.lastIndexOf('#') + 1);
                    const hasError = Object.keys(conflictMessages).some(key => key.endsWith(guid));
                    
                    if (hasError) {
                        // Se o nó explorado tem erro, fica com uma cor de erro em destaque
                        centralNode.color = { background: '#F87171', border: '#B91C1C' };
                    } else {
                        // Se for um nó válido, fica verde para indicar que é o foco
                        centralNode.color = '#68D391';
                    }
                }
            }
            
            drawGraph(newGraphData, conflictMessages, addChatMessageCallback);
        }
    });
};

// Limpa o grafo e exibe uma mensagem padrão.
export const resetGraph = () => {
    const graphContainer = document.getElementById('graph-container');
    if (network) { network.destroy(); network = null; }
    graphContainer.innerHTML = '<p class="p-4 text-gray-500 text-center">Grafo reiniciado. Faça uma consulta para visualizar.</p>';
};

// Encontra e foca em um nó específico no grafo, usado pela interação com o 3D.
export const highlightNodeInGraph = (globalId) => {
    if (!network || !globalId) return;
    const nodes = network.body.data.nodes.get({
        filter: item => item.id.endsWith(globalId)
    });
    if (nodes && nodes.length > 0) {
        const nodeId = nodes[0].id;
        network.setSelection({ nodes: [nodeId] });
        network.focus(nodeId, {
            scale: 1.5,
            animation: {
                duration: 1000,
                easingFunction: 'easeInOutQuad'
            }
        });
    }
};