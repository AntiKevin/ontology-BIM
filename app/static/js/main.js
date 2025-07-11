import { drawGraph, resetGraph, highlightNodeInGraph } from './graph.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // INICIALIZAÇÃO E SELETORES DE ELEMENTOS DOM
    // =================================================================================
    const uploadForm = document.getElementById('upload-form');
    const validateBtn = document.getElementById('validate-btn');
    const statusArea = document.getElementById('status-area');
    const reportContent = document.getElementById('report-content');
    const mainContent = document.getElementById('main-content');
    const chatWindow = document.getElementById('chat-window');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const resetBtn = document.getElementById('reset-btn');
    const fullGraphBtn = document.getElementById('full-graph-btn');
    const relationSelect = document.getElementById('relation-select');
    const objectSelect = document.getElementById('object-select');
    const generateQueryBtn = document.getElementById('generate-query-btn');
    const viewerContainer = document.getElementById('viewer-container');

    // =================================================================================
    // ESTADO GLOBAL DA APLICAÇÃO
    // =================================================================================
    let scene, camera, renderer, controls;
    let ifcModel = null; // Armazena o grupo que contém todos os objetos 3D do modelo
    let guidToMeshMap = new Map(); // Mapeia o GlobalId de um objeto ao seu mesh 3D
    let selectedObject = null; // Armazena o objeto 3D atualmente selecionado
    let conflictMessages = {}; // Armazena os erros de validação (GlobalId -> Mensagem)
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // =================================================================================
    // MATERIAIS PRÉ-DEFINIDOS (THREE.JS)
    // =================================================================================
    // Material para paredes, com transparência para visualização interna.
    const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x8090a0, transparent: true, opacity: 0.3, depthWrite: false });
    // Material padrão para todos os outros objetos válidos.
    const defaultMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    // Material para objetos que falharam na validação (vermelho sólido).
    const errorMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: 1 });
    // Material de destaque para objetos VÁLIDOS selecionados (amarelo).
    const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    // Material de destaque para objetos COM ERRO selecionados (vermelho escuro).
    const errorHighlightMaterial = new THREE.MeshBasicMaterial({ color: '#991B1B' });

    // =================================================================================
    // FUNÇÕES CENTRAIS DO VISUALIZADOR 3D
    // =================================================================================

    // Função dedicada para lidar com o redimensionamento da janela e do canvas.
    function onWindowResize() {
        if (!renderer || !camera) return;
        const width = viewerContainer.clientWidth;
        const height = viewerContainer.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }

    // Configura a cena, câmera, luzes e renderer do Three.js.
    const setupThreeJs = () => {
        if (renderer) { renderer.domElement.remove(); renderer.dispose(); }
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x222222);
        camera = new THREE.PerspectiveCamera(75, viewerContainer.clientWidth / viewerContainer.clientHeight || 1, 0.1, 1000);
        camera.position.set(15, 15, 15);
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        scene.add(ambientLight);
        const gridHelper = new THREE.GridHelper(100, 100, 0x555555, 0x333333);
        scene.add(gridHelper);
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        viewerContainer.appendChild(renderer.domElement);
        controls = new OrbitControls(camera, renderer.domElement);
        onWindowResize(); // Garante o tamanho correto na inicialização
        const animate = () => {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();
    };

    // Constrói o modelo 3D a partir dos dados de geometria recebidos do backend.
    const loadProcessedIFCModel = (elements3dData) => {
        if (ifcModel) scene.remove(ifcModel);
        guidToMeshMap.clear();
        const group = new THREE.Group();
        elements3dData.forEach(elementData => {
            if (!elementData.vertices || !elementData.indices || elementData.vertices.length === 0) return;
            try {
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(elementData.vertices, 3));
                geometry.setIndex(new THREE.Uint32BufferAttribute(elementData.indices, 1));
                geometry.computeVertexNormals();
                let material = (elementData.type === 'IfcWall' || elementData.type === 'IfcWallStandardCase') ? wallMaterial : defaultMaterial;
                const mesh = new THREE.Mesh(geometry, material.clone());
                mesh.userData = { ...elementData, originalMaterial: mesh.material }; // Guarda o material original de cada objeto
                group.add(mesh);
                guidToMeshMap.set(elementData.globalId, mesh);
            } catch (error) {
                console.error(`Erro ao processar elemento ${elementData.globalId}:`, error);
            }
        });
        ifcModel = group;
        // Corrige a orientação do modelo (IFC usa Z como "para cima", Three.js usa Y)
        ifcModel.rotation.x = -Math.PI / 2;
        scene.add(ifcModel);

        // Ajusta a câmera para enquadrar o modelo carregado
        const box = new THREE.Box3().setFromObject(ifcModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;
        camera.position.set(center.x, center.y + size.y, center.z + cameraZ);
        controls.target.copy(center);
        controls.update();
        addChatMessage(`Modelo 3D carregado! ${elements3dData.length} elementos processados.`, 'bot');
    };
    
    // Aplica o material de erro aos objetos que falharam na validação.
    const highlightValidationErrors = (validationResults) => {
        let highlightedCount = 0;
        validationResults.forEach(result => {
            if (result.type === 'CONFLITO' && result.element) {
                const guid = result.element.replace('ifc:', '');
                const mesh = guidToMeshMap.get(guid);
                if (mesh) {
                    mesh.material = errorMaterial;
                    mesh.userData.originalMaterial = errorMaterial; // O material "original" agora é o de erro
                    highlightedCount++;
                }
            }
        });
        if (highlightedCount > 0) addChatMessage(`Destacados ${highlightedCount} elementos com conflitos.`, 'bot');
    };

    // Lida com o clique do mouse no visualizador 3D.
    function onMouseClick(event) {
        // Restaura o material do objeto previamente selecionado
        if (selectedObject) {
            selectedObject.material = selectedObject.userData.originalMaterial;
            selectedObject = null;
        }
        
        // Calcula a posição do mouse e lança um raio
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        
        // Intersecta apenas com os objetos do modelo, ignorando o chão
        if (!ifcModel) return;
        const intersects = raycaster.intersectObjects(ifcModel.children, true);

        if (intersects.length > 0) {
            selectedObject = intersects[0].object;
            const guid = selectedObject.userData.globalId;

            // Verifica se o objeto clicado tem um erro e aplica o destaque correto
            const hasError = conflictMessages.hasOwnProperty(`ifc:${guid}`);
            selectedObject.material = hasError ? errorHighlightMaterial : highlightMaterial;
            
            // Exibe informações no chatbot e destaca o nó no grafo
            let info = `Objeto selecionado: ${selectedObject.userData.name || 'Sem nome'}`;
            if (guid) {
                info += `\nGlobalId: ${guid}`;
                highlightNodeInGraph(guid);
            }
            if (selectedObject.userData.type) info += `\nTipo: ${selectedObject.userData.type}`;
            addChatMessage(info, 'bot');
        }
    }

    // =================================================================================
    // FLUXO PRINCIPAL DA APLICAÇÃO (SUBMISSÃO DO FORMULÁRIO)
    // =================================================================================
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(uploadForm);
        showStatus('A validar e a processar o modelo...', false, true);
        validateBtn.disabled = true;
        mainContent.classList.add('hidden');
        conflictMessages = {}; // Reseta os conflitos da sessão anterior
        try {
            // 1. Configura a cena 3D
            setupThreeJs();
            addChatMessage('A validar e a processar o modelo...', 'bot');
            
            // 2. Envia o arquivo para o backend e espera a resposta
            const response = await fetch('/validate', { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Erro do servidor: ${response.status}`);
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            // 3. Se houver dados de geometria, carrega e destaca os erros
            if (data.elements_3d_data && data.elements_3d_data.length > 0) {
                loadProcessedIFCModel(data.elements_3d_data);
                if (data.validation) {
                    data.validation.forEach(item => {
                        if (item.type === 'CONFLITO' && item.element) {
                            conflictMessages[item.element] = item.message;
                        }
                    });
                    highlightValidationErrors(data.validation);
                }
            } else {
                addChatMessage('Nenhum dado de geometria 3D foi recebido do backend.', 'bot');
            }

            // 4. Exibe os resultados e componentes da UI
            showStatus('Validação e carregamento concluídos!', false);
            renderReport(data.validation);
            mainContent.classList.remove('hidden');
            onWindowResize(); // Garante o tamanho correto da viewport
            loadFullGraph();
            populateOntologyExplorer();
        } catch (error) {
            showStatus(`Erro: ${error.message}`, true);
            console.error(error);
            addChatMessage(`Falha crítica: ${error.message}. Verifique o console.`, 'bot');
        } finally {
            validateBtn.disabled = false;
        }
    });

    // =================================================================================
    // FUNÇÕES AUXILIARES (CHATBOT, UI, GRAFO)
    // =================================================================================
    const addChatMessage = (message, sender) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message p-3 rounded-lg max-w-2xl break-words shadow-sm ${sender === 'user' ? 'bg-indigo-500 text-white self-end ml-auto' : 'bg-gray-200 text-gray-800 self-start mr-auto'}`;
        messageDiv.innerHTML = message.replace(/\n/g, '<br>');
        chatWindow.appendChild(messageDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };
    const sendMessage = async () => {
        const message = userInput.value.trim();
        if (!message) return;
        addChatMessage(message, 'user');
        userInput.value = '';
        try {
            const response = await fetch('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: message }) });
            const data = await response.json();
            addChatMessage(data.answer, 'bot');
            if (data.object) {
                const graphResponse = await fetch(`/graph-data?object=${encodeURIComponent(data.object)}`);
                const graphData = await graphResponse.json();
                drawGraph(graphData, conflictMessages, addChatMessage);
            }
        } catch (error) {
            addChatMessage('Ocorreu um erro ao comunicar com o servidor.', 'bot');
        }
    };
    const showStatus = (message, isError = false, isLoading = false) => {
        let content = '';
        if (isLoading) {
            content = `<div class="flex justify-center items-center"><div class="spinner mr-3"></div><p>${message}</p></div>`;
        } else {
            content = `<p class="${isError ? 'text-red-600' : 'text-green-600'} font-semibold">${message}</p>`;
        }
        statusArea.innerHTML = content;
    };
    const renderReport = (results) => {
        reportContent.innerHTML = '';
        if (!results || results.length === 0) {
            reportContent.innerHTML = '<p>Nenhum resultado.</p>';
            return;
        }
        results.forEach(item => {
            let el = document.createElement('div');
            if (item.type === 'SUCESSO') {
                el.className = 'p-4 bg-green-50 border-l-4 border-green-500 text-green-800 rounded';
                el.innerHTML = `<p class="font-bold">Sucesso</p><p>${item.message}</p>`;
            } else if (item.type === 'CONFLITO') {
                el.className = 'p-4 bg-red-50 border-l-4 border-red-500 text-red-800 rounded';
                el.innerHTML = `<p class="font-bold">Conflito</p><p><strong>Elemento:</strong> <code>${item.element}</code></p><p><strong>Mensagem:</strong> ${item.message}</p><p class="mt-2 pt-2 border-t border-red-200"><strong>Sugestão IA:</strong> <span class="italic">${item.suggestion_llm}</span></p>`;
            }
            if (el.innerHTML) reportContent.appendChild(el);
        });
    };
    const populateOntologyExplorer = async () => {
        try {
            const response = await fetch('/ontology-summary');
            const data = await response.json();
            relationSelect.innerHTML = '<option value="">-- Selecione a Relação --</option>';
            data.relations.forEach(rel => {
                const option = document.createElement('option');
                option.value = rel;
                option.textContent = rel;
                relationSelect.appendChild(option);
            });
            objectSelect.innerHTML = '<option value="">-- Selecione o Objeto --</option>';
            data.types.forEach(type => {
                const optgroup = document.createElement('optgroup');
                optgroup.label = type.type;
                type.examples.forEach(ex => {
                    const option = document.createElement('option');
                    option.value = ex;
                    option.textContent = ex;
                    optgroup.appendChild(option);
                });
                objectSelect.appendChild(optgroup);
            });
        } catch (error) { console.error("Erro ao popular construtor:", error); }
    };
    const loadFullGraph = async () => {
        addChatMessage('A gerar o grafo completo...', 'bot');
        try {
            const response = await fetch('/api/full-graph');
            const graphData = await response.json();
            if (graphData.error) throw new Error(graphData.error);
            drawGraph(graphData, conflictMessages, addChatMessage);
            if (Object.keys(conflictMessages).length > 0) addChatMessage(`Conflitos encontrados destacados no grafo.`, 'bot');
        } catch (error) {
            addChatMessage(`Ocorreu um erro ao gerar o grafo: ${error.message}`, 'bot');
        }
    };
    const checkSelections = () => {
        generateQueryBtn.disabled = !(relationSelect.value && objectSelect.value);
    };
    const generateQuestion = () => {
        const relation = relationSelect.value;
        const object = objectSelect.value;
        if (!relation || !object) return;
        userInput.value = `Qual a relação '${relation}' para o objeto '${object}'?`;
        userInput.focus();
    };

    // Adiciona os listeners de eventos a todos os elementos interativos
    viewerContainer.addEventListener('click', onMouseClick);
    sendBtn.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    resetBtn.addEventListener('click', () => resetGraph());
    fullGraphBtn.addEventListener('click', loadFullGraph);
    relationSelect.addEventListener('change', checkSelections);
    objectSelect.addEventListener('change', checkSelections);
    generateQueryBtn.addEventListener('click', generateQuestion);
    window.addEventListener('resize', onWindowResize);
});