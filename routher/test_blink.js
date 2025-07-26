import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const BLINK_CONFIG = {
  API_KEY: process.env.BLINK_API_KEY,
  BTC_WALLET_ID: process.env.BLINK_BTC_WALLET_ID,
  USD_WALLET_ID: process.env.BLINK_USD_WALLET_ID,
  SERVER_URL: process.env.BLINK_SERVER_URL || 'https://api.blink.sv/graphql'
};

async function testarConexaoBlink() {
  console.log('🔍 Testando conexão com API Blink...\n');
  
  console.log('📋 Configurações:');
  console.log(`- Server URL: ${BLINK_CONFIG.SERVER_URL}`);
  console.log(`- API Key: ${BLINK_CONFIG.API_KEY ? BLINK_CONFIG.API_KEY.substring(0, 20) + '...' : 'NÃO CONFIGURADA'}`);
  console.log(`- BTC Wallet ID: ${BLINK_CONFIG.BTC_WALLET_ID || 'NÃO CONFIGURADA'}`);
  console.log(`- USD Wallet ID: ${BLINK_CONFIG.USD_WALLET_ID || 'NÃO CONFIGURADA'}\n`);

  if (!BLINK_CONFIG.API_KEY) {
    console.error('❌ BLINK_API_KEY não está configurada no arquivo .env');
    return;
  }

  try {
    // Teste 1: Verificar se as carteiras existem
    const queryWallets = `
      query Me {
        me {
          id
          defaultAccount {
            wallets {
              id
              walletCurrency
              balance
            }
          }
        }
      }
    `;

    console.log('📡 Fazendo requisição para verificar carteiras...');
    
    const response = await fetch(BLINK_CONFIG.SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': BLINK_CONFIG.API_KEY
      },
      body: JSON.stringify({
        query: queryWallets
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error('❌ Erro GraphQL:', data.errors);
      return;
    }

    console.log('✅ Conexão com API Blink bem-sucedida!\n');
    console.log('📱 Informações da conta:');
    console.log(`- User ID: ${data.data.me.id}`);
    console.log('- Carteiras disponíveis:');
    
    data.data.me.defaultAccount.wallets.forEach(wallet => {
      console.log(`  • ${wallet.walletCurrency}: ${wallet.id} (Saldo: ${wallet.balance})`);
    });

    // Verificar se as carteiras configuradas existem
    const wallets = data.data.me.defaultAccount.wallets;
    const btcWallet = wallets.find(w => w.id === BLINK_CONFIG.BTC_WALLET_ID);
    const usdWallet = wallets.find(w => w.id === BLINK_CONFIG.USD_WALLET_ID);

    console.log('\n🔍 Verificação das carteiras configuradas:');
    
    if (btcWallet) {
      console.log(`✅ BTC Wallet encontrada: ${btcWallet.id} (${btcWallet.walletCurrency})`);
    } else {
      console.log(`❌ BTC Wallet ${BLINK_CONFIG.BTC_WALLET_ID} não encontrada`);
    }

    if (usdWallet) {
      console.log(`✅ USD Wallet encontrada: ${usdWallet.id} (${usdWallet.walletCurrency})`);
    } else {
      console.log(`❌ USD Wallet ${BLINK_CONFIG.USD_WALLET_ID} não encontrada`);
    }

    // Teste 2: Criar um invoice de teste pequeno
    if (usdWallet) {
      console.log('\n🧪 Testando criação de invoice...');
      
      const testQuery = `
        mutation LnUsdInvoiceCreate($input: LnUsdInvoiceCreateInput!) {
          lnUsdInvoiceCreate(input: $input) {
            invoice {
              paymentRequest
              paymentHash
              satoshis
            }
            errors {
              message
              path
            }
          }
        }
      `;

      const testVariables = {
        input: {
          walletId: BLINK_CONFIG.USD_WALLET_ID,
          amount: 1, // 1 centavo USD
          memo: 'Teste Venus Bot'
        }
      };

      const testResponse = await fetch(BLINK_CONFIG.SERVER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': BLINK_CONFIG.API_KEY
        },
        body: JSON.stringify({
          query: testQuery,
          variables: testVariables
        })
      });

      const testData = await testResponse.json();

      if (testData.data.lnUsdInvoiceCreate.errors && testData.data.lnUsdInvoiceCreate.errors.length > 0) {
        console.log('❌ Erro ao criar invoice teste:', testData.data.lnUsdInvoiceCreate.errors[0].message);
      } else {
        console.log('✅ Invoice de teste criado com sucesso!');
        console.log(`- Payment Hash: ${testData.data.lnUsdInvoiceCreate.invoice.paymentHash}`);
        console.log(`- Satoshis: ${testData.data.lnUsdInvoiceCreate.invoice.satoshis}`);
        console.log('- Payment Request gerado (primeiros 50 chars):', testData.data.lnUsdInvoiceCreate.invoice.paymentRequest.substring(0, 50) + '...');
      }
    }

    console.log('\n🎉 Teste concluído! A integração Blink está pronta para uso.');

  } catch (error) {
    console.error('❌ Erro durante o teste:', error.message);
    console.error('\n💡 Dicas para resolução:');
    console.error('1. Verifique se a BLINK_API_KEY está correta');
    console.error('2. Verifique se os IDs das carteiras estão corretos');
    console.error('3. Verifique sua conexão com a internet');
    console.error('4. Verifique se a conta Blink está ativa');
  }
}

// Executar o teste
testarConexaoBlink();
